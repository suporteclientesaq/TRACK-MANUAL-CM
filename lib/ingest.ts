import "server-only";
import { mergeLead, parseLead, type ParsedLead } from "./leona";
import { LEAD_BULK_COLS, nowIso } from "./store-rows";
import { findLead, findLeadsByPhones, insertLead, insertLeads, isUniqueViolation, updateLead, updateLeadsBulk } from "./store";
import type { Lead } from "./types";

export type IngestResult =
  | { ok: true; leadId: string; created: boolean }
  | { ok: false; error: string };

/**
 * Cria ou atualiza um lead a partir de campos soltos (webhook da Leona,
 * formulário). Mesmo número no mesmo cliente = atualização.
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
  return result;
}
