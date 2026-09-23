import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import {
  AD_COLS,
  CLIENT_COLS,
  LEAD_BULK_COLS,
  LEAD_COLS,
  nowIso,
  num,
  str,
  toAd,
  toClient,
  toEvent,
  toLead,
  type Row,
  type StoreImpl,
} from "./store-rows";
import type { EventRow } from "./types";

/**
 * Modo online pela API do Supabase (PostgREST), sem string de conexão do Postgres.
 * É o que a extensão do Supabase no Netlify entrega: o endereço do projeto
 * (SUPABASE_DATABASE_URL, https://xxxx.supabase.co) e a chave de serviço
 * (SUPABASE_SERVICE_ROLE_KEY). As tabelas não podem ser criadas por aqui: a
 * pessoa cola o SQL de lib/schema-sql.ts uma vez no SQL Editor do Supabase.
 */

export type RestConfig = { base: string; key: string; url: string };

export function restConfig(): RestConfig | null {
  const raw = (
    process.env.SUPABASE_DATABASE_URL ||
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ""
  ).trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
  if (!raw || !key || !/^https?:\/\//i.test(raw)) return null;
  const url = raw.replace(/\/+$/, "");
  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }
  let base = url;
  if (/\.supabase\.(co|in|red)$/i.test(hostname) && !/\/rest\/v1$/.test(url)) base = `${url}/rest/v1`;
  return { base, key, url };
}

/**
 * Que chave é essa? O Supabase tem as chaves antigas (JWT com o papel dentro:
 * anon / service_role) e as novas (sb_publishable_… / sb_secret_…). O painel
 * precisa da chave de serviço; com a pública, a RLS esconde tudo e nada grava.
 */
export function keyRole(key: string): "service_role" | "anon" | "secret" | "publishable" | "unknown" {
  if (key.startsWith("sb_secret_")) return "secret";
  if (key.startsWith("sb_publishable_")) return "publishable";
  const parts = key.split(".");
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { role?: string };
      if (payload.role === "service_role") return "service_role";
      if (payload.role === "anon") return "anon";
    } catch {
      return "unknown";
    }
  }
  return "unknown";
}

export class RestError extends Error {
  status: number;
  code: string;
  details: string;
  hint: string;
  constructor(status: number, body: { code?: string; message?: string; details?: string; hint?: string } | null, fallback: string) {
    super(body?.message || fallback);
    this.name = "RestError";
    this.status = status;
    this.code = String(body?.code || "");
    this.details = String(body?.details || "");
    this.hint = String(body?.hint || "");
  }
}

type Query = Record<string, string | number | undefined>;

type ReqOptions = {
  query?: Query;
  body?: unknown;
  prefer?: string[];
  headers?: Record<string, string>;
};

type Result<T> = { data: T; count: number | null; status: number };

function cfg(): RestConfig {
  const c = restConfig();
  if (!c) throw new Error("SUPABASE_DATABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configuradas.");
  return c;
}

async function req<T = unknown>(method: string, table: string, o: ReqOptions = {}): Promise<Result<T>> {
  const c = cfg();
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(o.query || {})) if (v !== undefined) qs.append(k, String(v));
  const url = `${c.base}/${table}${qs.size ? "?" + qs.toString() : ""}`;
  const headers: Record<string, string> = {
    apikey: c.key,
    Authorization: `Bearer ${c.key}`,
    Accept: "application/json",
    ...(o.headers || {}),
  };
  if (o.body !== undefined) headers["Content-Type"] = "application/json";
  if (o.prefer?.length) headers["Prefer"] = o.prefer.join(", ");
  const res = await fetch(url, {
    method,
    headers,
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  const text = method === "HEAD" ? "" : await res.text();
  if (!res.ok) {
    let body: { code?: string; message?: string; details?: string; hint?: string } | null = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    throw new RestError(res.status, body, `HTTP ${res.status} em ${table}`);
  }
  let count: number | null = null;
  const range = res.headers.get("content-range");
  if (range && range.includes("/")) {
    const n = Number(range.split("/")[1]);
    count = Number.isFinite(n) ? n : null;
  }
  const data = (text ? JSON.parse(text) : null) as T;
  return { data, count, status: res.status };
}

const get = <T = Row[]>(table: string, query: Query, prefer?: string[]) => req<T>("GET", table, { query, prefer });

async function count(table: string, query: Query): Promise<number> {
  const r = await req("HEAD", table, { query: { ...query, select: "id" }, prefer: ["count=exact"] });
  return r.count ?? 0;
}

/** Valor entre aspas para os filtros do PostgREST (vírgula, ponto e parênteses são reservados). */
const quote = (v: unknown) => `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const inList = (values: unknown[]) => `in.(${values.map(quote).join(",")})`;

function toSql(v: unknown): unknown {
  if (v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return v;
}

/** Objeto com exatamente as colunas pedidas (o PostgREST exige chaves iguais em inserts em lote). */
function pick(row: Row, cols: readonly string[]): Row {
  const out: Row = {};
  for (const c of cols) out[c] = toSql(row[c]);
  return out;
}

const CHUNK = 200;
const IN_CHUNK = 150;

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const LEAD_ALL_COLS = ["id", ...LEAD_COLS] as const;

function leadRow(row: Row, id: string): Row {
  const t = nowIso();
  const full = pick({ ...row, id }, LEAD_ALL_COLS);
  full.country = row.country || "br";
  full.origin = row.origin || "manual";
  full.first_seen_at = String(row.first_seen_at || t);
  full.updated_at = t;
  return full;
}

const SENT = { status: "eq.enviado", is_test: "eq.false" };

export const restStore: StoreImpl = {
  kind: "supabase-rest",

  async listClients() {
    return (await get("clients", { select: "*", order: "name.asc" })).data.map(toClient).sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    );
  },
  async getClient(id) {
    const r = (await get("clients", { select: "*", id: `eq.${id}`, limit: 1 })).data[0];
    return r ? toClient(r) : null;
  },
  async getClientByWebhookKey(key) {
    const r = (await get("clients", { select: "*", webhook_key: `eq.${key}`, limit: 1 })).data[0];
    return r ? toClient(r) : null;
  },
  async insertClient(row) {
    const id = randomUUID();
    const t = nowIso();
    await req("POST", "clients", {
      body: {
        id,
        name: String(row.name),
        webhook_key: randomBytes(24).toString("hex"),
        pixel_id: toSql(row.pixel_id),
        capi_token_enc: toSql(row.capi_token_enc),
        page_id: toSql(row.page_id),
        waba_id: toSql(row.waba_id),
        id_mode: String(row.id_mode || "page"),
        ad_account_id: toSql(row.ad_account_id),
        marketing_token_enc: toSql(row.marketing_token_enc),
        test_event_code: toSql(row.test_event_code),
        default_currency: String(row.default_currency || "BRL"),
        send_extra_data: row.send_extra_data !== false,
        created_at: t,
        updated_at: t,
      },
      prefer: ["return=minimal"],
    });
    return id;
  },
  async updateClient(id, patch) {
    const keys = Object.keys(patch).filter((k) => (CLIENT_COLS as readonly string[]).includes(k));
    const body = pick({ ...patch, updated_at: nowIso() }, [...keys, "updated_at"]);
    await req("PATCH", "clients", { query: { id: `eq.${id}` }, body, prefer: ["return=minimal"] });
  },

  async getLead(id) {
    const r = (await get("leads", { select: "*", id: `eq.${id}`, limit: 1 })).data[0];
    return r ? toLead(r) : null;
  },
  async findLead(clientId, phone) {
    const r = (await get("leads", { select: "*", client_id: `eq.${clientId}`, phone: `eq.${phone}`, limit: 1 })).data[0];
    return r ? toLead(r) : null;
  },
  async findLeadsByPhones(clientId, phones) {
    const out = [];
    for (const part of chunks([...new Set(phones)], IN_CHUNK)) {
      const rows = (await get("leads", { select: "*", client_id: `eq.${clientId}`, phone: inList(part) })).data;
      out.push(...rows.map(toLead));
    }
    return out;
  },
  async listLeads(f) {
    const conds: string[] = [];
    if (f.clientId) conds.push(`client_id.eq.${quote(f.clientId)}`);
    if (f.filter === "com-ctwa") conds.push("ctwa_clid.not.is.null", 'ctwa_clid.neq.""');
    if (f.filter === "sem-ctwa") conds.push('or(ctwa_clid.is.null,ctwa_clid.eq."")');
    const text = (f.q || "").trim();
    if (text) {
      const digits = text.replace(/\D/g, "");
      const parts = [`name.ilike.${quote(`*${text.replace(/\*/g, " ")}*`)}`, `source_id.eq.${quote(digits || "-")}`];
      if (digits.length >= 4) parts.push(`phone.like.${quote(`*${digits}*`)}`);
      conds.push(`or(${parts.join(",")})`);
    }
    const query: Query = { select: "*", order: "first_seen_at.desc", limit: f.limit, offset: f.offset };
    if (conds.length) query.and = `(${conds.join(",")})`;
    return (await get("leads", query)).data.map(toLead);
  },
  async insertLead(row) {
    const id = randomUUID();
    await req("POST", "leads", { body: leadRow(row, id), prefer: ["return=minimal"] });
    return id;
  },
  async insertLeads(rows) {
    if (rows.length === 0) return 0;
    for (const part of chunks(rows, CHUNK)) {
      await req("POST", "leads", {
        query: { columns: LEAD_ALL_COLS.join(",") },
        body: part.map((r) => leadRow(r, randomUUID())),
        prefer: ["return=minimal"],
      });
    }
    return rows.length;
  },
  async updateLead(id, patch) {
    const keys = Object.keys(patch).filter((k) => (LEAD_COLS as readonly string[]).includes(k));
    const body = pick({ ...patch, updated_at: nowIso() }, [...keys, "updated_at"]);
    await req("PATCH", "leads", { query: { id: `eq.${id}` }, body, prefer: ["return=minimal"] });
  },
  async updateLeadsBulk(rows) {
    if (rows.length === 0) return 0;
    // Upsert pela chave primária: o INSERT por baixo exige as colunas obrigatórias
    // que a linha em lote não traz (client_id, first_seen_at), então elas são lidas antes.
    const cols = ["id", "client_id", "first_seen_at", ...LEAD_BULK_COLS];
    for (const part of chunks(rows, CHUNK)) {
      const ids = part.map((r) => String(r.id));
      const base = new Map<string, Row>();
      for (const ip of chunks(ids, IN_CHUNK)) {
        for (const r of (await get("leads", { select: "id,client_id,first_seen_at", id: inList(ip) })).data) base.set(String(r.id), r);
      }
      const body = part
        .filter((r) => base.has(String(r.id)))
        .map((r) => {
          const b = base.get(String(r.id))!;
          const full = pick({ ...r, client_id: b.client_id, first_seen_at: b.first_seen_at }, cols);
          full.country = r.country || "br";
          full.updated_at = r.updated_at || nowIso();
          return full;
        });
      if (body.length === 0) continue;
      await req("POST", "leads", {
        query: { columns: cols.join(","), on_conflict: "id" },
        body,
        prefer: ["resolution=merge-duplicates", "return=minimal"],
      });
    }
    return rows.length;
  },
  async deleteLead(id) {
    await req("DELETE", "leads", { query: { id: `eq.${id}` }, prefer: ["return=minimal"] });
  },

  async listEventsForLead(leadId) {
    return (await get("events", { select: "*", lead_id: `eq.${leadId}`, order: "created_at.desc" })).data.map(toEvent);
  },
  async listEvents(f) {
    const query: Query = {
      select: "*,leads(name,phone),clients(name)",
      order: "created_at.desc",
      limit: f.limit,
      offset: f.offset,
    };
    if (f.status === "enviado" || f.status === "erro") query.status = `eq.${f.status}`;
    const rows = (await get("events", query)).data;
    return rows.map((r) => {
      const lead = (r.leads || null) as Row | null;
      const client = (r.clients || null) as Row | null;
      return {
        ...toEvent(r),
        lead_name: str(lead?.name),
        lead_phone: str(lead?.phone),
        client_name: str(client?.name),
      };
    });
  },
  async getEvent(id) {
    const r = (await get("events", { select: "*", id: `eq.${id}`, limit: 1 })).data[0];
    return r ? toEvent(r) : null;
  },
  async insertEvent(row) {
    const id = randomUUID();
    await req("POST", "events", {
      body: {
        id,
        client_id: String(row.client_id),
        lead_id: String(row.lead_id),
        event_name: String(row.event_name),
        event_id: String(row.event_id),
        event_time: String(row.event_time),
        value: toSql(row.value),
        currency: toSql(row.currency),
        content_name: toSql(row.content_name),
        action_source: String(row.action_source),
        is_test: !!row.is_test,
        status: String(row.status),
        http_status: toSql(row.http_status),
        events_received: toSql(row.events_received),
        fbtrace_id: toSql(row.fbtrace_id),
        error_message: toSql(row.error_message),
        payload: row.payload ?? null,
        response: row.response ?? null,
        created_at: nowIso(),
      },
      prefer: ["return=minimal"],
    });
    return id;
  },
  async countSent(leadId, eventName) {
    return count("events", { lead_id: `eq.${leadId}`, event_name: `eq.${eventName}`, ...SENT });
  },
  async sentForLeads(leadIds) {
    const out = new Map<string, EventRow[]>();
    if (leadIds.length === 0) return out;
    for (const part of chunks([...new Set(leadIds)], IN_CHUNK)) {
      const rows = (await get("events", { select: "*", ...SENT, lead_id: inList(part), order: "created_at.asc" })).data;
      for (const r of rows) {
        const ev = toEvent(r);
        out.set(ev.lead_id, [...(out.get(ev.lead_id) || []), ev]);
      }
    }
    return out;
  },
  async recentSent(sinceIso) {
    const rows = (await get("events", { select: "event_name,value", ...SENT, created_at: `gte.${sinceIso}`, limit: 5000 })).data;
    return rows.map((r) => ({ event_name: String(r.event_name), value: num(r.value) }));
  },
  async contentNames(clientId) {
    const rows = (
      await get("events", {
        select: "content_name",
        client_id: `eq.${clientId}`,
        content_name: "not.is.null",
        order: "created_at.desc",
        limit: 500,
      })
    ).data;
    const tally = new Map<string, number>();
    for (const r of rows) {
      const name = String(r.content_name || "");
      if (!name) continue;
      tally.set(name, (tally.get(name) || 0) + 1);
    }
    return [...tally.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([name]) => name);
  },

  async getAd(clientId, adId) {
    const r = (await get("ad_cache", { select: "*", client_id: `eq.${clientId}`, ad_id: `eq.${adId}`, limit: 1 })).data[0];
    return r ? toAd(r) : null;
  },
  async adsFor(pairs) {
    const out = new Map();
    const adIds = [...new Set(pairs.map((p) => p.adId))];
    for (const part of chunks(adIds, IN_CHUNK)) {
      for (const r of (await get("ad_cache", { select: "*", ad_id: inList(part) })).data) {
        const ad = toAd(r);
        out.set(`${ad.client_id}:${ad.ad_id}`, ad);
      }
    }
    return out;
  },
  async upsertAd(row) {
    const body = pick({ ...row, fetched_at: nowIso() }, ["client_id", "ad_id", ...AD_COLS, "fetched_at"]);
    await req("POST", "ad_cache", {
      query: { on_conflict: "client_id,ad_id" },
      body,
      prefer: ["resolution=merge-duplicates", "return=minimal"],
    });
  },

  async getSetting(key) {
    const r = (await get("settings", { select: "value", key: `eq.${key}`, limit: 1 })).data[0];
    return r ? String(r.value) : null;
  },
  async setSettings(values) {
    const body = Object.entries(values).map(([key, value]) => ({ key, value }));
    if (body.length === 0) return;
    await req("POST", "settings", {
      query: { on_conflict: "key" },
      body,
      prefer: ["resolution=merge-duplicates", "return=minimal"],
    });
  },

  async stats() {
    const [clients, leads, events] = await Promise.all([count("clients", {}), count("leads", {}), count("events", {})]);
    return { clients, leads, events, dbBytes: null };
  },
  isUniqueViolation(e) {
    return e instanceof RestError && (e.code === "23505" || e.status === 409);
  },
};

/** Explicação em português de um erro da API, para a tela de configuração. */
export function explainRestError(err: unknown, c: RestConfig): string {
  const host = (() => {
    try {
      return new URL(c.url).host;
    } catch {
      return c.url;
    }
  })();
  if (err instanceof RestError) {
    if (err.code === "PGRST205" || err.code === "42P01" || (err.status === 404 && /relation|table|schema cache/i.test(err.message))) {
      return "TABELAS_FALTANDO";
    }
    if (err.status === 401 || err.status === 403 || /JWT|jwt|invalid.*key|permission denied/i.test(err.message)) {
      return `O Supabase recusou a chave (${err.message}). A variável SUPABASE_SERVICE_ROLE_KEY precisa ser a chave "service_role" do projeto ${host} (Project Settings > API Keys). A extensão do Supabase no Netlify preenche isso sozinha; se você editou a variável na mão, apague e deixe a extensão recriar.`;
    }
    if (err.status === 404) {
      return `A API do Supabase não respondeu no endereço ${c.base} (404). Confira a variável SUPABASE_DATABASE_URL: tem de ser https://<código do projeto>.supabase.co.`;
    }
    if (err.status === 540 || err.status === 503 || /paused|pausado/i.test(err.message)) {
      return `O projeto ${host} parece pausado no Supabase (projetos gratuitos pausam depois de uma semana sem uso). Abra o projeto no Supabase e clique em Restore.`;
    }
    return `A API do Supabase (${host}) devolveu um erro: ${err.message}${err.hint ? ` (${err.hint})` : ""}`;
  }
  const e = err as { name?: string; code?: string; message?: string; cause?: { code?: string; message?: string } };
  const cause = e?.cause?.code || e?.code || "";
  if (e?.name === "TimeoutError" || e?.name === "AbortError") {
    return `A API do Supabase (${host}) não respondeu. Confira se o projeto está ativo (Restore, se estiver pausado) e se o endereço em SUPABASE_DATABASE_URL está certo.`;
  }
  if (cause === "ENOTFOUND" || cause === "EAI_AGAIN") {
    return `O endereço ${host} não existe. Confira a variável SUPABASE_DATABASE_URL (https://<código do projeto>.supabase.co).`;
  }
  return `Não consegui falar com a API do Supabase (${host}): ${e?.cause?.message || e?.message || String(err)}`;
}

const g = globalThis as unknown as { __trackRestCheck?: { base: string; at: number; problem: string | null } };

/**
 * Testa a API e as tabelas. Devolve null quando está tudo certo, "TABELAS_FALTANDO"
 * quando o SQL ainda não foi rodado, ou uma explicação do erro.
 */
export async function checkRest(): Promise<string | null> {
  const c = restConfig();
  if (!c) return "SUPABASE_DATABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configuradas.";
  const role = keyRole(c.key);
  if (role === "anon" || role === "publishable") {
    return `A variável SUPABASE_SERVICE_ROLE_KEY está com a chave pública (${role === "anon" ? "anon" : "publishable"}) do projeto, e com ela o painel não consegue gravar nada. Ela precisa ser a chave "service_role" (Project Settings > API Keys > service_role, em "Legacy API keys") ou uma chave "secret". A extensão do Supabase no Netlify preenche isso sozinha; se a variável foi editada na mão, apague e deixe a extensão recriar.`;
  }
  const cached = g.__trackRestCheck;
  const now = Date.now();
  // Sucesso vale para sempre; erro vale 15 s; "faltam tabelas" é testado a cada acesso,
  // para a tela mudar assim que a pessoa rodar o SQL e recarregar.
  if (cached && cached.base === c.base && cached.problem !== "TABELAS_FALTANDO" && (cached.problem === null || now - cached.at < 15_000)) {
    return cached.problem;
  }
  let problem: string | null = null;
  try {
    // Uma tabela de cada grupo: se faltar qualquer uma, o SQL precisa ser rodado.
    await Promise.all([
      get("settings", { select: "key", limit: 1 }),
      get("clients", { select: "id", limit: 1 }),
      get("leads", { select: "id", limit: 1 }),
      get("events", { select: "id", limit: 1 }),
      get("ad_cache", { select: "ad_id", limit: 1 }),
    ]);
  } catch (e) {
    problem = explainRestError(e, c);
  }
  g.__trackRestCheck = { base: c.base, at: now, problem };
  return problem;
}
