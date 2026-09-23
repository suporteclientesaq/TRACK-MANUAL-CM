import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
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
 * Modo online: Postgres (Supabase, Neon ou qualquer outro) apontado por DATABASE_URL.
 * As tabelas são criadas sozinhas na primeira conexão.
 */

const SCHEMA = `
create table if not exists clients (
  id                  text primary key,
  name                text not null,
  webhook_key         text not null unique,
  pixel_id            text,
  capi_token_enc      text,
  page_id             text,
  waba_id             text,
  id_mode             text not null default 'page',
  ad_account_id       text,
  marketing_token_enc text,
  test_event_code     text,
  default_currency    text not null default 'BRL',
  send_extra_data     boolean not null default true,
  created_at          text not null,
  updated_at          text not null
);

create table if not exists leads (
  id             text primary key,
  client_id      text not null references clients(id) on delete cascade,
  name           text,
  phone          text not null,
  email          text,
  city           text,
  state          text,
  zip            text,
  country        text not null default 'br',
  ctwa_clid      text,
  source_id      text,
  source_url     text,
  source_type    text,
  thumbnail_url  text,
  media_url      text,
  headline       text,
  ad_body        text,
  origin         text not null default 'manual',
  notes          text,
  raw            jsonb,
  first_seen_at  text not null,
  clid_seen_at   text,
  updated_at     text not null,
  unique (client_id, phone)
);
create index if not exists leads_client_seen_idx on leads (client_id, first_seen_at desc);
create index if not exists leads_source_idx on leads (source_id);

create table if not exists events (
  id              text primary key,
  client_id       text not null references clients(id) on delete cascade,
  lead_id         text not null references leads(id) on delete cascade,
  event_name      text not null,
  event_id        text not null,
  event_time      text not null,
  value           numeric(12,2),
  currency        text,
  content_name    text,
  action_source   text not null,
  is_test         boolean not null default false,
  status          text not null,
  http_status     integer,
  events_received integer,
  fbtrace_id      text,
  error_message   text,
  payload         jsonb not null,
  response        jsonb,
  created_at      text not null
);
create index if not exists events_lead_idx on events (lead_id, created_at desc);
create index if not exists events_client_idx on events (client_id, created_at desc);

create table if not exists ad_cache (
  client_id      text not null references clients(id) on delete cascade,
  ad_id          text not null,
  ad_name        text,
  ad_status      text,
  adset_id       text,
  adset_name     text,
  campaign_id    text,
  campaign_name  text,
  creative_title text,
  creative_body  text,
  thumbnail_url  text,
  spend          numeric(12,2),
  impressions    bigint,
  clicks         bigint,
  conversations  bigint,
  raw            jsonb,
  fetched_at     text not null,
  primary key (client_id, ad_id)
);

create table if not exists settings (
  key   text primary key,
  value text not null
);
`;

const g = globalThis as unknown as { __trackPool?: Pool; __trackPoolUrl?: string; __trackSchema?: Promise<void> };

export function databaseUrl(): string {
  return (process.env.DATABASE_URL || "").trim();
}

function pool(): Pool {
  const url = databaseUrl();
  if (!url) throw new Error("DATABASE_URL não configurada.");
  if (g.__trackPool && g.__trackPoolUrl === url) return g.__trackPool;
  let host = "";
  let sslmode = "";
  try {
    const u = new URL(url);
    host = u.hostname;
    sslmode = u.searchParams.get("sslmode") || "";
  } catch {
    host = "";
  }
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "";
  const ssl = sslmode === "disable" || local ? undefined : { rejectUnauthorized: false };
  g.__trackPool = new Pool({
    connectionString: url,
    ssl,
    // Funções serverless abrem poucas conexões por instância; o Supabase tem limite.
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  g.__trackPoolUrl = url;
  g.__trackSchema = undefined;
  return g.__trackPool;
}

async function ready(): Promise<Pool> {
  const p = pool();
  if (!g.__trackSchema) {
    g.__trackSchema = p.query(SCHEMA).then(() => undefined);
    g.__trackSchema.catch(() => {
      g.__trackSchema = undefined; // tenta de novo na próxima chamada
    });
  }
  await g.__trackSchema;
  return p;
}

async function q<T extends QueryResultRow = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  const p = await ready();
  const res = await p.query<T>(sql, params);
  return res.rows;
}

async function one<T extends QueryResultRow = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(sql, params);
  return rows[0] ?? null;
}

function toSql(v: unknown): unknown {
  if (v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return v;
}

/** Valor para coluna jsonb: o driver serializa objetos, mas null precisa ser explícito. */
const json = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));

async function update(table: string, id: string, patch: Row, allowed: readonly string[]) {
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (keys.length === 0) return;
  const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  const values = keys.map((k) => (k === "raw" ? json(patch[k]) : toSql(patch[k])));
  await q(`update ${table} set ${sets} where id = $${keys.length + 1}`, [...values, id]);
}

const LEAD_INSERT_COLS = LEAD_COLS.filter((c) => c !== "updated_at" && c !== "first_seen_at");

function leadValues(row: Row, id: string): unknown[] {
  const t = nowIso();
  const withDefaults: Row = { ...row, country: row.country || "br", origin: row.origin || "manual" };
  return [
    id,
    ...LEAD_INSERT_COLS.map((c) => (c === "raw" ? json(withDefaults.raw) : toSql(withDefaults[c]))),
    String(row.first_seen_at || t),
    t,
  ];
}

const CHUNK = 200;

async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const p = await ready();
  const c = await p.connect();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
}

export const pgStore: StoreImpl = {
  kind: "postgres",

  async listClients() {
    return (await q("select * from clients order by lower(name)")).map(toClient);
  },
  async getClient(id) {
    const r = await one("select * from clients where id = $1", [id]);
    return r ? toClient(r) : null;
  },
  async getClientByWebhookKey(key) {
    const r = await one("select * from clients where webhook_key = $1", [key]);
    return r ? toClient(r) : null;
  },
  async insertClient(row) {
    const id = randomUUID();
    const t = nowIso();
    await q(
      `insert into clients (id, name, webhook_key, pixel_id, capi_token_enc, page_id, waba_id, id_mode, ad_account_id,
         marketing_token_enc, test_event_code, default_currency, send_extra_data, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        id, String(row.name), randomBytes(24).toString("hex"), toSql(row.pixel_id), toSql(row.capi_token_enc),
        toSql(row.page_id), toSql(row.waba_id), String(row.id_mode || "page"), toSql(row.ad_account_id),
        toSql(row.marketing_token_enc), toSql(row.test_event_code), String(row.default_currency || "BRL"),
        row.send_extra_data !== false, t, t,
      ]
    );
    return id;
  },
  async updateClient(id, patch) {
    await update("clients", id, { ...patch, updated_at: nowIso() }, CLIENT_COLS);
  },

  async getLead(id) {
    const r = await one("select * from leads where id = $1", [id]);
    return r ? toLead(r) : null;
  },
  async findLead(clientId, phone) {
    const r = await one("select * from leads where client_id = $1 and phone = $2", [clientId, phone]);
    return r ? toLead(r) : null;
  },
  async findLeadsByPhones(clientId, phones) {
    if (phones.length === 0) return [];
    return (await q("select * from leads where client_id = $1 and phone = any($2::text[])", [clientId, phones])).map(toLead);
  },
  async listLeads(f) {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (f.clientId) where.push(`client_id = ${add(f.clientId)}`);
    if (f.filter === "com-ctwa") where.push("ctwa_clid is not null and ctwa_clid <> ''");
    if (f.filter === "sem-ctwa") where.push("(ctwa_clid is null or ctwa_clid = '')");
    const text = (f.q || "").trim();
    if (text) {
      const digits = text.replace(/\D/g, "");
      const parts = [`name ilike ${add(`%${text.replace(/[\\%_]/g, "\\$&")}%`)}`, `source_id = ${add(digits || "-")}`];
      if (digits.length >= 4) parts.push(`phone like ${add(`%${digits}%`)}`);
      where.push(`(${parts.join(" or ")})`);
    }
    const sql = `select * from leads ${where.length ? "where " + where.join(" and ") : ""} order by first_seen_at desc limit ${add(f.limit)} offset ${add(f.offset)}`;
    return (await q(sql, params)).map(toLead);
  },
  async insertLead(row) {
    const id = randomUUID();
    const width = LEAD_INSERT_COLS.length + 3; // id + colunas + first_seen_at + updated_at
    const placeholders = Array.from({ length: width }, (_, k) => `$${k + 1}`).join(", ");
    await q(
      `insert into leads (id, ${LEAD_INSERT_COLS.join(", ")}, first_seen_at, updated_at) values (${placeholders})`,
      leadValues(row, id)
    );
    return id;
  },
  async insertLeads(rows) {
    if (rows.length === 0) return 0;
    const width = LEAD_INSERT_COLS.length + 3;
    await withClient(async (c) => {
      await c.query("begin");
      try {
        for (let i = 0; i < rows.length; i += CHUNK) {
          const chunk = rows.slice(i, i + CHUNK);
          const values: unknown[] = [];
          const tuples = chunk.map((r, ri) => {
            values.push(...leadValues(r, randomUUID()));
            return `(${Array.from({ length: width }, (_, k) => `$${ri * width + k + 1}`).join(", ")})`;
          });
          await c.query(
            `insert into leads (id, ${LEAD_INSERT_COLS.join(", ")}, first_seen_at, updated_at) values ${tuples.join(", ")}`,
            values
          );
        }
        await c.query("commit");
      } catch (e) {
        await c.query("rollback");
        throw e;
      }
    });
    return rows.length;
  },
  async updateLead(id, patch) {
    await update("leads", id, { ...patch, updated_at: nowIso() }, LEAD_COLS);
  },
  async updateLeadsBulk(rows) {
    if (rows.length === 0) return 0;
    const cols = [...LEAD_BULK_COLS];
    const width = cols.length + 1;
    await withClient(async (c) => {
      await c.query("begin");
      try {
        for (let i = 0; i < rows.length; i += CHUNK) {
          const chunk = rows.slice(i, i + CHUNK);
          const values: unknown[] = [];
          const tuples = chunk.map((r, ri) => {
            values.push(String(r.id), ...cols.map((col) => toSql(r[col])));
            return `(${Array.from({ length: width }, (_, k) => `$${ri * width + k + 1}::text`).join(", ")})`;
          });
          await c.query(
            `update leads as l set ${cols.map((col) => `${col} = v.${col}`).join(", ")}
             from (values ${tuples.join(", ")}) as v(id, ${cols.join(", ")}) where l.id = v.id`,
            values
          );
        }
        await c.query("commit");
      } catch (e) {
        await c.query("rollback");
        throw e;
      }
    });
    return rows.length;
  },
  async deleteLead(id) {
    await q("delete from leads where id = $1", [id]);
  },

  async listEventsForLead(leadId) {
    return (await q("select * from events where lead_id = $1 order by created_at desc", [leadId])).map(toEvent);
  },
  async listEvents(f) {
    const filtered = f.status === "enviado" || f.status === "erro";
    const rows = await q(
      `select e.*, l.name as lead_name, l.phone as lead_phone, c.name as client_name
       from events e left join leads l on l.id = e.lead_id left join clients c on c.id = e.client_id
       ${filtered ? "where e.status = $3" : ""} order by e.created_at desc limit $1 offset $2`,
      filtered ? [f.limit, f.offset, f.status] : [f.limit, f.offset]
    );
    return rows.map((r) => ({ ...toEvent(r), lead_name: str(r.lead_name), lead_phone: str(r.lead_phone), client_name: str(r.client_name) }));
  },
  async getEvent(id) {
    const r = await one("select * from events where id = $1", [id]);
    return r ? toEvent(r) : null;
  },
  async insertEvent(row) {
    const id = randomUUID();
    await q(
      `insert into events (id, client_id, lead_id, event_name, event_id, event_time, value, currency, content_name,
         action_source, is_test, status, http_status, events_received, fbtrace_id, error_message, payload, response, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [
        id, String(row.client_id), String(row.lead_id), String(row.event_name), String(row.event_id), String(row.event_time),
        toSql(row.value), toSql(row.currency), toSql(row.content_name), String(row.action_source), !!row.is_test,
        String(row.status), toSql(row.http_status), toSql(row.events_received), toSql(row.fbtrace_id),
        toSql(row.error_message), JSON.stringify(row.payload ?? null), JSON.stringify(row.response ?? null), nowIso(),
      ]
    );
    return id;
  },
  async countSent(leadId, eventName) {
    const r = await one(
      "select count(*)::int as c from events where lead_id = $1 and event_name = $2 and status = 'enviado' and is_test = false",
      [leadId, eventName]
    );
    return Number(r?.c ?? 0);
  },
  async sentForLeads(leadIds) {
    const out = new Map<string, EventRow[]>();
    if (leadIds.length === 0) return out;
    const rows = await q(
      "select * from events where status = 'enviado' and is_test = false and lead_id = any($1::text[]) order by created_at",
      [leadIds]
    );
    for (const r of rows) {
      const ev = toEvent(r);
      out.set(ev.lead_id, [...(out.get(ev.lead_id) || []), ev]);
    }
    return out;
  },
  async recentSent(sinceIso) {
    const rows = await q(
      "select event_name, value from events where status = 'enviado' and is_test = false and created_at >= $1",
      [sinceIso]
    );
    return rows.map((r) => ({ event_name: String(r.event_name), value: num(r.value) }));
  },
  async contentNames(clientId) {
    const rows = await q(
      "select content_name, count(*) as c from events where client_id = $1 and content_name is not null and content_name <> '' group by content_name order by c desc limit 30",
      [clientId]
    );
    return rows.map((r) => String(r.content_name));
  },

  async getAd(clientId, adId) {
    const r = await one("select * from ad_cache where client_id = $1 and ad_id = $2", [clientId, adId]);
    return r ? toAd(r) : null;
  },
  async adsFor(pairs) {
    const out = new Map();
    const adIds = [...new Set(pairs.map((p) => p.adId))];
    if (adIds.length === 0) return out;
    const rows = await q("select * from ad_cache where ad_id = any($1::text[])", [adIds]);
    for (const r of rows) {
      const ad = toAd(r);
      out.set(`${ad.client_id}:${ad.ad_id}`, ad);
    }
    return out;
  },
  async upsertAd(row) {
    const sets = AD_COLS.map((c) => `${c} = excluded.${c}`).join(", ");
    await q(
      `insert into ad_cache (client_id, ad_id, ${AD_COLS.join(", ")}, fetched_at)
       values ($1, $2, ${AD_COLS.map((_, i) => `$${i + 3}`).join(", ")}, $${AD_COLS.length + 3})
       on conflict (client_id, ad_id) do update set ${sets}, fetched_at = excluded.fetched_at`,
      [
        String(row.client_id), String(row.ad_id),
        ...AD_COLS.map((c) => (c === "raw" ? json(row.raw) : toSql(row[c]))),
        nowIso(),
      ]
    );
  },

  async getSetting(key) {
    const r = await one("select value from settings where key = $1", [key]);
    return r ? String(r.value) : null;
  },
  async setSettings(values) {
    for (const [k, v] of Object.entries(values)) {
      await q("insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value", [k, v]);
    }
  },

  async stats() {
    const r = await one(
      "select (select count(*) from clients)::int as clients, (select count(*) from leads)::int as leads, (select count(*) from events)::int as events"
    );
    return { clients: Number(r?.clients ?? 0), leads: Number(r?.leads ?? 0), events: Number(r?.events ?? 0), dbBytes: null };
  },
  isUniqueViolation(e) {
    return !!e && typeof e === "object" && (e as { code?: string }).code === "23505";
  },
};
