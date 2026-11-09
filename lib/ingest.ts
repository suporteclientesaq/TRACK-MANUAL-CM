import "server-only";
import { appSecret } from "./config";
import { decrypt } from "./crypto";
import { metaApiVersion } from "./env";
import { mergeLead, parseLead, type ParsedLead } from "./leona";
import { fetchAd } from "./meta";
import { nowIso } from "./store-rows";
import { mergeLeadUpdate, withTrackingTouch } from "./lead-tracking";
import {
  findLead,
  findLeadsByPhones,
  getClient,
  insertLead,
  insertLeads,
  isUniqueViolation,
  updateLeadWithRaw,
  upsertAd,
} from "./store";
import type { Lead } from "./types";

export type IngestResult =
  { ok: true; leadId: string; created: boolean } | { ok: false; error: string };

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
  },
): Promise<void> {
  if (!adId || !/^\d{6,}$/.test(adId)) return;

  try {
    // 1. Salva imediatamente o que veio no WhatsApp para exibir no painel na hora
    await upsertAd({
      client_id: clientId,
      ad_id: adId,
      ...(fallback?.creative_title
        ? {
            creative_title: fallback.creative_title,
            ad_name: fallback.creative_title,
          }
        : {}),
      ...(fallback?.creative_body
        ? { creative_body: fallback.creative_body }
        : {}),
      ...(fallback?.thumbnail_url
        ? { thumbnail_url: fallback.thumbnail_url }
        : {}),
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
        ad_name:
          res.ad.ad_name ||
          fallback?.creative_title ||
          `Anúncio #${adId.slice(-6)}`,
        ad_status: res.ad.ad_status,
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
        raw: res.ad.raw,
      });
      console.log(
        `[Track Manual] Anúncio ${adId} enriquecido em tempo real: Campanha="${res.ad.campaign_name}", Conjunto="${res.ad.adset_name}", Criativo="${res.ad.creative_title || res.ad.ad_name}"`,
      );
    }
  } catch (err) {
    console.warn(
      `[Track Manual] Aviso ao enriquecer anúncio ${adId} em tempo real:`,
      err,
    );
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
  raw?: unknown,
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
  const clidChanged =
    !!merged.ctwa_clid && merged.ctwa_clid !== existing?.ctwa_clid;
  const newRawObj = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;

  // Promove pushName/notifyName/verifiedName do raw para a coluna name se o lead ainda está sem nome
  const rawPushName =
    (typeof newRawObj.pushName === "string" && newRawObj.pushName.trim()) ||
    (typeof newRawObj.pushname === "string" && newRawObj.pushname.trim()) ||
    (typeof newRawObj.notifyName === "string" && newRawObj.notifyName.trim()) ||
    (typeof newRawObj.verifiedName === "string" &&
      newRawObj.verifiedName.trim()) ||
    null;
  if (newRawObj.fromMe === true && existing) merged.name = existing.name;
  if (
    newRawObj.fromMe !== true &&
    rawPushName &&
    (!merged.name || merged.name === "Sem Nome")
  ) {
    merged.name = rawPushName;
  }

  const row: Record<string, unknown> = {
    ...merged,
    ...(clidChanged ? { clid_seen_at: t } : {}),
  };

  if (existing) {
    await updateLeadWithRaw(
      existing.id,
      row,
      withTrackingTouch(raw, { ...incoming }, origin),
    );
    return { ok: true, leadId: existing.id, created: false };
  }

  try {
    const id = await insertLead({
      ...mergeLeadUpdate(
        {},
        row,
        withTrackingTouch(raw, { ...incoming }, origin),
        t,
      ),
      client_id: clientId,
      origin,
      first_seen_at: t,
    });
    return { ok: true, leadId: id, created: true };
  } catch (e) {
    if (isUniqueViolation(e)) {
      const again = await findLead(clientId, incoming.phone);
      if (again) {
        const freshMerged = mergeLead(again, incoming);
        if (newRawObj.fromMe === true) freshMerged.name = again.name;
        await updateLeadWithRaw(
          again.id,
          {
            ...freshMerged,
            ...(freshMerged.ctwa_clid &&
            freshMerged.ctwa_clid !== again.ctwa_clid
              ? { clid_seen_at: t }
              : {}),
          },
          withTrackingTouch(raw, { ...incoming }, origin),
        );
        return { ok: true, leadId: again.id, created: false };
      }
    }
    return {
      ok: false,
      error: `Não foi possível salvar o lead: ${e instanceof Error ? e.message : String(e)}`,
    };
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
 * Importação CSV: insere novos contatos em lote e atualiza referências sob
 * lock/CAS para não misturar um clique com um webhook concorrente.
 * Mesmo telefone repetido no arquivo: vale a última linha.
 */
export async function ingestMany(
  clientId: string,
  records: Record<string, unknown>[],
): Promise<BulkResult> {
  const result: BulkResult = {
    total: records.length,
    created: 0,
    updated: 0,
    skipped: 0,
    problems: [],
  };

  const byPhone = new Map<string, ParsedLead>();
  records.forEach((rec, i) => {
    const parsed = parseLead(rec);
    if (!parsed.ok) {
      result.skipped++;
      if (result.problems.length < 10)
        result.problems.push(`Linha ${i + 2}: ${parsed.error}`);
      return;
    }
    byPhone.set(parsed.lead.phone, parsed.lead);
  });
  if (byPhone.size === 0) return result;

  const existing = new Map<string, Lead>();
  for (const l of await findLeadsByPhones(clientId, [...byPhone.keys()]))
    existing.set(l.phone, l);

  const t = nowIso();
  const toInsert: Record<string, unknown>[] = [];
  const toUpdate: {
    id: string;
    patch: Record<string, unknown>;
    incoming: ParsedLead;
  }[] = [];
  for (const [phone, incoming] of byPhone) {
    const old = existing.get(phone) || null;
    const merged = mergeLead(old, incoming);
    if (!old) {
      toInsert.push({
        ...mergeLeadUpdate(
          {},
          merged,
          withTrackingTouch(undefined, { ...incoming }, "csv", t),
          t,
        ),
        client_id: clientId,
        origin: "manual",
        first_seen_at: t,
        clid_seen_at: incoming.ctwa_clid ? t : null,
      });
      continue;
    }
    toUpdate.push({ id: old.id, patch: merged, incoming });
  }

  if (toInsert.length) {
    result.created = await insertLeads(toInsert);
    if (result.created < toInsert.length) {
      // A webhook may create a contact after our initial lookup. Reconcile the
      // same observations through the locked update instead of losing the CSV.
      const candidates = await findLeadsByPhones(
        clientId,
        toInsert.map((row) => String(row.phone)),
      );
      for (let offset = 0; offset < candidates.length; offset += 4) {
        await Promise.all(
          candidates.slice(offset, offset + 4).map((row) => {
            const incoming = byPhone.get(row.phone)!;
            return updateLeadWithRaw(
              row.id,
              mergeLead(row, incoming),
              withTrackingTouch(undefined, { ...incoming }, "csv", t),
            );
          }),
        );
      }
      result.updated += toInsert.length - result.created;
    }
  }
  // Apply reference tuples against the latest row, including while a webhook
  // arrives during an import. Four CAS/row-lock updates at a time bound pressure.
  for (let offset = 0; offset < toUpdate.length; offset += 4) {
    const part = toUpdate.slice(offset, offset + 4);
    await Promise.all(
      part.map((item) =>
        updateLeadWithRaw(
          item.id,
          item.patch,
          withTrackingTouch(undefined, { ...item.incoming }, "csv", t),
        ),
      ),
    );
    result.updated += part.length;
  }

  // Dispara o enriquecimento de campanha, conjunto e criativo para todos os anúncios importados
  const sourceIds = [
    ...new Set(
      [...byPhone.values()]
        .map((l) => l.source_id)
        .filter((s): s is string => Boolean(s)),
    ),
  ];
  for (const adId of sourceIds) {
    enrichAdInRealTime(clientId, adId).catch(() => {});
  }

  return result;
}
