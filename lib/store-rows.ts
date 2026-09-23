import type { AdInfo, Client, EventRow, Lead } from "./types";

/**
 * Conversão entre linhas do banco (SQLite ou Postgres) e os tipos do painel.
 * Os conversores são tolerantes: aceitam 0/1 ou boolean, número ou string
 * numérica, JSON já decodificado ou em texto, Date ou texto ISO.
 */

export type Row = Record<string, unknown>;

export const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
export const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

export function fromJson(v: unknown): unknown {
  if (typeof v !== "string") return v ?? null;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

export function toClient(r: Row): Client {
  return {
    id: String(r.id),
    name: String(r.name),
    webhook_key: String(r.webhook_key),
    pixel_id: str(r.pixel_id),
    capi_token_enc: str(r.capi_token_enc),
    page_id: str(r.page_id),
    waba_id: str(r.waba_id),
    id_mode: r.id_mode === "waba" ? "waba" : "page",
    ad_account_id: str(r.ad_account_id),
    marketing_token_enc: str(r.marketing_token_enc),
    test_event_code: str(r.test_event_code),
    default_currency: String(r.default_currency || "BRL"),
    send_extra_data: !!r.send_extra_data,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

export function toLead(r: Row): Lead {
  return {
    id: String(r.id),
    client_id: String(r.client_id),
    name: str(r.name),
    phone: String(r.phone),
    email: str(r.email),
    city: str(r.city),
    state: str(r.state),
    zip: str(r.zip),
    country: String(r.country || "br"),
    ctwa_clid: str(r.ctwa_clid),
    source_id: str(r.source_id),
    source_url: str(r.source_url),
    source_type: str(r.source_type),
    thumbnail_url: str(r.thumbnail_url),
    media_url: str(r.media_url),
    headline: str(r.headline),
    ad_body: str(r.ad_body),
    origin: r.origin === "leona" ? "leona" : "manual",
    notes: str(r.notes),
    raw: fromJson(r.raw),
    first_seen_at: iso(r.first_seen_at),
    clid_seen_at: r.clid_seen_at === null || r.clid_seen_at === undefined ? null : iso(r.clid_seen_at),
    updated_at: iso(r.updated_at),
  };
}

export function toEvent(r: Row): EventRow {
  return {
    id: String(r.id),
    client_id: String(r.client_id),
    lead_id: String(r.lead_id),
    event_name: String(r.event_name),
    event_id: String(r.event_id),
    event_time: iso(r.event_time),
    value: num(r.value),
    currency: str(r.currency),
    content_name: str(r.content_name),
    action_source: String(r.action_source),
    is_test: !!r.is_test,
    status: r.status === "enviado" ? "enviado" : "erro",
    http_status: num(r.http_status),
    events_received: num(r.events_received),
    fbtrace_id: str(r.fbtrace_id),
    error_message: str(r.error_message),
    payload: fromJson(r.payload),
    response: fromJson(r.response),
    created_at: iso(r.created_at),
  };
}

export function toAd(r: Row): AdInfo {
  return {
    client_id: String(r.client_id),
    ad_id: String(r.ad_id),
    ad_name: str(r.ad_name),
    ad_status: str(r.ad_status),
    adset_id: str(r.adset_id),
    adset_name: str(r.adset_name),
    campaign_id: str(r.campaign_id),
    campaign_name: str(r.campaign_name),
    creative_title: str(r.creative_title),
    creative_body: str(r.creative_body),
    thumbnail_url: str(r.thumbnail_url),
    spend: num(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    conversations: num(r.conversations),
    raw: fromJson(r.raw),
    fetched_at: iso(r.fetched_at),
  };
}

/** Colunas que podem ser alteradas por um update de cliente. */
export const CLIENT_COLS = [
  "name", "pixel_id", "capi_token_enc", "page_id", "waba_id", "id_mode", "ad_account_id",
  "marketing_token_enc", "test_event_code", "default_currency", "send_extra_data", "updated_at",
] as const;

/** Colunas de lead, na ordem usada nos inserts. */
export const LEAD_COLS = [
  "client_id", "name", "phone", "email", "city", "state", "zip", "country", "ctwa_clid", "source_id",
  "source_url", "source_type", "thumbnail_url", "media_url", "headline", "ad_body", "origin", "notes",
  "raw", "first_seen_at", "clid_seen_at", "updated_at",
] as const;

/** Colunas de lead que a importação em lote atualiza (raw fica como está). */
export const LEAD_BULK_COLS = LEAD_COLS.filter((c) => c !== "client_id" && c !== "raw" && c !== "first_seen_at" && c !== "origin");

export const AD_COLS = [
  "ad_name", "ad_status", "adset_id", "adset_name", "campaign_id", "campaign_name", "creative_title",
  "creative_body", "thumbnail_url", "spend", "impressions", "clicks", "conversations", "raw",
] as const;

export const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Interface que as duas implementações cumprem
// ---------------------------------------------------------------------------

export interface LeadFilter {
  clientId?: string | null;
  filter?: string; // todos | com-ctwa | sem-ctwa
  q?: string;
  offset: number;
  limit: number;
}

export type EventWithNames = EventRow & { lead_name: string | null; lead_phone: string | null; client_name: string | null };

export interface Stats {
  clients: number;
  leads: number;
  events: number;
  dbBytes: number | null;
}

type MaybeAsync<T> = T | Promise<T>;

export interface StoreImpl {
  readonly kind: "sqlite" | "postgres";

  listClients(): MaybeAsync<Client[]>;
  getClient(id: string): MaybeAsync<Client | null>;
  getClientByWebhookKey(key: string): MaybeAsync<Client | null>;
  insertClient(row: Row): MaybeAsync<string>;
  updateClient(id: string, patch: Row): MaybeAsync<void>;

  getLead(id: string): MaybeAsync<Lead | null>;
  findLead(clientId: string, phone: string): MaybeAsync<Lead | null>;
  findLeadsByPhones(clientId: string, phones: string[]): MaybeAsync<Lead[]>;
  listLeads(f: LeadFilter): MaybeAsync<Lead[]>;
  insertLead(row: Row): MaybeAsync<string>;
  insertLeads(rows: Row[]): MaybeAsync<number>;
  updateLead(id: string, patch: Row): MaybeAsync<void>;
  /** Atualiza várias linhas de uma vez; cada linha traz id + todas as LEAD_BULK_COLS. */
  updateLeadsBulk(rows: Row[]): MaybeAsync<number>;
  deleteLead(id: string): MaybeAsync<void>;

  listEventsForLead(leadId: string): MaybeAsync<EventRow[]>;
  listEvents(f: { status?: string; offset: number; limit: number }): MaybeAsync<EventWithNames[]>;
  getEvent(id: string): MaybeAsync<EventRow | null>;
  insertEvent(row: Row): MaybeAsync<string>;
  countSent(leadId: string, eventName: string): MaybeAsync<number>;
  sentForLeads(leadIds: string[]): MaybeAsync<Map<string, EventRow[]>>;
  recentSent(sinceIso: string): MaybeAsync<{ event_name: string; value: number | null }[]>;
  contentNames(clientId: string): MaybeAsync<string[]>;

  getAd(clientId: string, adId: string): MaybeAsync<AdInfo | null>;
  adsFor(pairs: { clientId: string; adId: string }[]): MaybeAsync<Map<string, AdInfo>>;
  upsertAd(row: Row): MaybeAsync<void>;

  getSetting(key: string): MaybeAsync<string | null>;
  setSettings(values: Record<string, string>): MaybeAsync<void>;

  stats(): MaybeAsync<Stats>;
  isUniqueViolation(e: unknown): boolean;
}
