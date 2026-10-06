import "server-only";
import { appSecret } from "./config";
import { decrypt } from "./crypto";
import { metaApiVersion } from "./env";
import { mergeLead, parseLead, type ParsedLead } from "./leona";
import { fetchAd } from "./meta";
import { LEAD_BULK_COLS, nowIso } from "./store-rows";
import {
  findLead,
  findLeadsByPhones,
  getClient,
  insertLead,
  insertLeads,
  isUniqueViolation,
  updateLead,
  updateLeadsBulk,
  upsertAd,
} from "./store";
import type { Lead } from "./types";

export type IngestResult =
  | { ok: true; leadId: string; created: boolean }
  | { ok: false; error: string };

/**
 * Enriquece dados do anúncio (Campanha, Conjunto, Criativo, Gasto) em tempo real
 * no exato momento em que o lead manda mensagem no WhatsApp ou é importado.
 */
export async function enrichAdInRealTime(
  clientId: string,
  adId: string,
  fallback?: {
    creative_title?: string | null;
    creative_body?: string | null;
    thumbnail_url?: string | null;
  }
): Promise<void> {
  if (!adId || !/^\d{6,}$/.test(adId)) return;

  try {
    // 1. Salva imediatamente o que veio no WhatsApp para exibir no painel na hora
    await upsertAd({
      client_id: clientId,
      ad_id: adId,
      ...(fallback?.creative_title ? { creative_title: fallback.creative_title, ad_name: fallback.creative_title } : {}),
      ...(fallback?.creative_body ? { creative_body: fallback.creative_body } : {}),
      ...(fallback?.thumbnail_url ? { thumbnail_url: fallback.thumbnail_url } : {}),
    });

    // 2. Busca o cliente para pegar o token do Meta
    const client = await getClient(clientId);
    if (!client) return;

    const tokenEnc = client.marketing_token_enc || client.capi_token_enc;
    if (!tokenEnc) return;

    const secret = await appSecret();
    const token = decrypt(tokenEnc, secret);
    if (!token) return;

    // 3. Consulta a Graph API do Meta para extrair Campanha, Conjunto, Anúncio e Criativo
    const res = await fetchAd({
      apiVersion: metaApiVersion(),
      adId,
      accessToken: token,
    });

    if (res.ok && res.ad) {
      await upsertAd({
        client_id: clientId,
        ad_id: adId,
        ad_name: res.ad.ad_name || fallback?.creative_title || `Anúncio #${adId.slice(-6)}`,
        ad_status: res.ad.ad_status || "ACTIVE",
        adset_id: res.ad.adset_id,
        adset_name: res.ad.adset_name,
        campaign_id: res.ad.campaign_id,
        campaign_name: res.ad.campaign_name,
        creative_title: res.ad.creative_title || fallback?.creative_title,
        creative_body: res.ad.creative_body || fallback?.creative_body,
        thumbnail_url: res.ad.thumbnail_url || fallback?.thumbnail_url,
        spend: res.ad.spend,
        impressions: res.ad.impressions,
        clicks: res.ad.clicks,
        conversations: res.ad.conversations,
      });
      console.log(`[Track Manual] Anúncio ${adId} enriquecido em tempo real: Campanha="${res.ad.campaign_name}", Conjunto="${res.ad.adset_name}", Criativo="${res.ad.creative_title || res.ad.ad_name}"`);
    }
  } catch (err) {
    console.warn(`[Track Manual] Aviso ao enriquecer anúncio ${adId} em tempo real:`, err);
  }
}

/**
 * Cria ou atualiza um lead a partir de campos soltos (webhook da Leona,
 * WhatsApp, formulário). Mesmo número no mesmo cliente = atualização.
 */
export async function ingestLead(
  clientId: string,
  fields: Record<string, unknown>,
  origin: "leona" | "manual",
  raw?: unknown
): Promise<IngestResult> {
  const parsed = parseLead(fields);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const incoming = parsed.lead;

  // Dispara o enriquecimento de campanha, conjunto e criativo em tempo real
  if (incoming.source_id) {
    enrichAdInRealTime(clientId, incoming.source_id, {
      creative_title: incoming.headline,
      creative_body: incoming.ad_body,
      thumbnail_url: incoming.thumbnail_url,
    }).catch(() => {});
  }

  const existing = await findLead(clientId, incoming.phone);
  const t = nowIso();
  const merged = mergeLead(existing, incoming);
  const clidChanged = !!incoming.ctwa_clid && incoming.ctwa_clid !== existing?.ctwa_clid;
  const row: Record<string, unknown> = {
    ...merged,
    ...(raw !== undefined ? { raw } : {}),
    ...(clidChanged ? { clid_seen_at: t } : {}),
  };

  if (existing) {
    await updateLead(existing.id, row);
    return { ok: true, leadId: existing.id, created: false };
  }

  try {
    const id = await insertLead({ ...row, client_id: clientId, origin, first_seen_at: t });
    return { ok: true, leadId: id, created: true };
  } catch (e) {
    if (isUniqueViolation(e)) {
      const again = await findLead(clientId, incoming.phone);
      if (again) {
        await updateLead(again.id, row);
        return { ok: true, leadId: again.id, created: false };
      }
    }
    return { ok: false, error: `Não foi possível salvar o lead: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export interface BulkResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  problems: string[];
}

/**
 * Importação em lote (CSV): poucas consultas ao banco, mesmo com milhares de
 * linhas, para caber no tempo de uma função serverless.
 * Mesmo telefone repetido no arquivo: vale a última linha.
 */
export async function ingestMany(clientId: string, records: Record<string, unknown>[]): Promise<BulkResult> {
  const result: BulkResult = { total: records.length, created: 0, updated: 0, skipped: 0, problems: [] };

  const byPhone = new Map<string, ParsedLead>();
  records.forEach((rec, i) => {
    const parsed = parseLead(rec);
    if (!parsed.ok) {
      result.skipped++;
      if (result.problems.length < 10) result.problems.push(`Linha ${i + 2}: ${parsed.error}`);
      return;
    }
    byPhone.set(parsed.lead.phone, parsed.lead);
  });
  if (byPhone.size === 0) return result;

  const existing = new Map<string, Lead>();
  for (const l of await findLeadsByPhones(clientId, [...byPhone.keys()])) existing.set(l.phone, l);

  const t = nowIso();
  const toInsert: Record<string, unknown>[] = [];
  const toUpdate: Record<string, unknown>[] = [];
  for (const [phone, incoming] of byPhone) {
    const old = existing.get(phone) || null;
    const merged = mergeLead(old, incoming);
    if (!old) {
      toInsert.push({ ...merged, client_id: clientId, origin: "manual", first_seen_at: t, clid_seen_at: incoming.ctwa_clid ? t : null });
      continue;
    }
    const clidChanged = !!incoming.ctwa_clid && incoming.ctwa_clid !== old.ctwa_clid;
    const full: Record<string, unknown> = { id: old.id };
    for (const col of LEAD_BULK_COLS) full[col] = col in merged ? merged[col] : (old as unknown as Record<string, unknown>)[col];
    full.clid_seen_at = clidChanged ? t : old.clid_seen_at;
    full.updated_at = t;
    full.country = full.country || "br";
    toUpdate.push(full);
  }

  if (toInsert.length) result.created = await insertLeads(toInsert);
  if (toUpdate.length) result.updated = await updateLeadsBulk(toUpdate);

  // Dispara o enriquecimento de campanha, conjunto e criativo para todos os anúncios importados
  const sourceIds = [...new Set([...byPhone.values()].map((l) => l.source_id).filter((s): s is string => Boolean(s)))];
  for (const adId of sourceIds) {
    enrichAdInRealTime(clientId, adId).catch(() => {});
  }

  return result;
}
