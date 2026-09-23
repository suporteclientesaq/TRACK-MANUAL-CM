import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
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
 * Modo local: um único arquivo SQLite dentro da pasta data/, usando o SQLite
 * embutido no Node (22.13+), sem nada para instalar.
 */

export function dataDir(): string {
  const dir = process.env.TRACK_DATA_DIR?.trim() || path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function dbPath(): string {
  return path.join(dataDir(), "track-manual.db");
}

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
  send_extra_data     integer not null default 1,
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
  raw            text,
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
  value           real,
  currency        text,
  content_name    text,
  action_source   text not null,
  is_test         integer not null default 0,
  status          text not null,
  http_status     integer,
  events_received integer,
  fbtrace_id      text,
  error_message   text,
  payload         text not null,
  response        text,
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
  spend          real,
  impressions    integer,
  clicks         integer,
  conversations  integer,
  raw            text,
  fetched_at     text not null,
  primary key (client_id, ad_id)
);

create table if not exists settings (
  key   text primary key,
  value text not null
);
`;

type Sqlite = typeof import("node:sqlite");
const g = globalThis as unknown as { __trackDb?: DatabaseSync; __trackDbPath?: string };

function db(): DatabaseSync {
  const file = dbPath();
  if (g.__trackDb && g.__trackDbPath === file) return g.__trackDb;
  // getBuiltinModule evita que o empacotador tente resolver o módulo nativo.
  const sqlite = process.getBuiltinModule("node:sqlite") as Sqlite;
  const conn = new sqlite.DatabaseSync(file);
  conn.exec("pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;");
  conn.exec(SCHEMA);
  g.__trackDb = conn;
  g.__trackDbPath = file;
  return conn;
}

type SqlValue = string | number | null;

function toSql(v: unknown): SqlValue {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" || typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v);
}

function update(table: string, id: string, patch: Row, allowed: readonly string[]) {
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  db().prepare(`update ${table} set ${sets} where id = ?`).run(...keys.map((k) => toSql(patch[k])), id);
}

const LEAD_INSERT_COLS = LEAD_COLS.filter((c) => c !== "updated_at" && c !== "first_seen_at");

function insertOneLead(row: Row): string {
  const id = randomUUID();
  const t = nowIso();
  const withDefaults: Row = { ...row, country: row.country || "br", origin: row.origin || "manual" };
  db()
    .prepare(
      `insert into leads (id, ${LEAD_INSERT_COLS.join(", ")}, first_seen_at, updated_at)
       values (?, ${LEAD_INSERT_COLS.map(() => "?").join(", ")}, ?, ?)`
    )
    .run(id, ...LEAD_INSERT_COLS.map((c) => toSql(withDefaults[c])), String(row.first_seen_at || t), t);
  return id;
}

export const sqliteStore: StoreImpl = {
  kind: "sqlite",

  listClients() {
    return (db().prepare("select * from clients order by name collate nocase").all() as Row[]).map(toClient);
  },
  getClient(id) {
    const r = db().prepare("select * from clients where id = ?").get(id) as Row | undefined;
    return r ? toClient(r) : null;
  },
  getClientByWebhookKey(key) {
    const r = db().prepare("select * from clients where webhook_key = ?").get(key) as Row | undefined;
    return r ? toClient(r) : null;
  },
  insertClient(row) {
    const id = randomUUID();
    const t = nowIso();
    db()
      .prepare(
        `insert into clients (id, name, webhook_key, pixel_id, capi_token_enc, page_id, waba_id, id_mode, ad_account_id,
           marketing_token_enc, test_event_code, default_currency, send_extra_data, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id, String(row.name), randomBytes(24).toString("hex"), toSql(row.pixel_id), toSql(row.capi_token_enc),
        toSql(row.page_id), toSql(row.waba_id), String(row.id_mode || "page"), toSql(row.ad_account_id),
        toSql(row.marketing_token_enc), toSql(row.test_event_code), String(row.default_currency || "BRL"),
        row.send_extra_data === false ? 0 : 1, t, t
      );
    return id;
  },
  updateClient(id, patch) {
    update("clients", id, { ...patch, updated_at: nowIso() }, CLIENT_COLS);
  },

  getLead(id) {
    const r = db().prepare("select * from leads where id = ?").get(id) as Row | undefined;
    return r ? toLead(r) : null;
  },
  findLead(clientId, phone) {
    const r = db().prepare("select * from leads where client_id = ? and phone = ?").get(clientId, phone) as Row | undefined;
    return r ? toLead(r) : null;
  },
  findLeadsByPhones(clientId, phones) {
    if (phones.length === 0) return [];
    const out: Row[] = [];
    const stmt = db().prepare("select * from leads where client_id = ? and phone = ?");
    for (const p of phones) {
      const r = stmt.get(clientId, p) as Row | undefined;
      if (r) out.push(r);
    }
    return out.map(toLead);
  },
  listLeads(f) {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (f.clientId) {
      where.push("client_id = ?");
      params.push(f.clientId);
    }
    if (f.filter === "com-ctwa") where.push("ctwa_clid is not null and ctwa_clid <> ''");
    if (f.filter === "sem-ctwa") where.push("(ctwa_clid is null or ctwa_clid = '')");
    const q = (f.q || "").trim();
    if (q) {
      const digits = q.replace(/\D/g, "");
      const parts = ["name like ? escape '\\'", "source_id = ?"];
      params.push(`%${q.replace(/[\\%_]/g, "\\$&")}%`, digits || "-");
      if (digits.length >= 4) {
        parts.push("phone like ?");
        params.push(`%${digits}%`);
      }
      where.push(`(${parts.join(" or ")})`);
    }
    const sql = `select * from leads ${where.length ? "where " + where.join(" and ") : ""} order by first_seen_at desc limit ? offset ?`;
    params.push(f.limit, f.offset);
    return (db().prepare(sql).all(...params) as Row[]).map(toLead);
  },
  insertLead(row) {
    return insertOneLead(row);
  },
  insertLeads(rows) {
    const conn = db();
    conn.exec("begin");
    try {
      for (const r of rows) insertOneLead(r);
      conn.exec("commit");
    } catch (e) {
      conn.exec("rollback");
      throw e;
    }
    return rows.length;
  },
  updateLead(id, patch) {
    update("leads", id, { ...patch, updated_at: nowIso() }, LEAD_COLS);
  },
  updateLeadsBulk(rows) {
    const conn = db();
    const sets = LEAD_BULK_COLS.map((c) => `${c} = ?`).join(", ");
    const stmt = conn.prepare(`update leads set ${sets} where id = ?`);
    conn.exec("begin");
    try {
      for (const r of rows) stmt.run(...LEAD_BULK_COLS.map((c) => toSql(r[c])), String(r.id));
      conn.exec("commit");
    } catch (e) {
      conn.exec("rollback");
      throw e;
    }
    return rows.length;
  },
  deleteLead(id) {
    db().prepare("delete from leads where id = ?").run(id);
  },

  listEventsForLead(leadId) {
    return (db().prepare("select * from events where lead_id = ? order by created_at desc").all(leadId) as Row[]).map(toEvent);
  },
  listEvents(f) {
    const where = f.status === "enviado" || f.status === "erro" ? "where e.status = ?" : "";
    const params: SqlValue[] = where ? [f.status!, f.limit, f.offset] : [f.limit, f.offset];
    const rows = db()
      .prepare(
        `select e.*, l.name as lead_name, l.phone as lead_phone, c.name as client_name
         from events e left join leads l on l.id = e.lead_id left join clients c on c.id = e.client_id
         ${where} order by e.created_at desc limit ? offset ?`
      )
      .all(...params) as Row[];
    return rows.map((r) => ({ ...toEvent(r), lead_name: str(r.lead_name), lead_phone: str(r.lead_phone), client_name: str(r.client_name) }));
  },
  getEvent(id) {
    const r = db().prepare("select * from events where id = ?").get(id) as Row | undefined;
    return r ? toEvent(r) : null;
  },
  insertEvent(row) {
    const id = randomUUID();
    db()
      .prepare(
        `insert into events (id, client_id, lead_id, event_name, event_id, event_time, value, currency, content_name,
           action_source, is_test, status, http_status, events_received, fbtrace_id, error_message, payload, response, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id, String(row.client_id), String(row.lead_id), String(row.event_name), String(row.event_id), String(row.event_time),
        toSql(row.value), toSql(row.currency), toSql(row.content_name), String(row.action_source), row.is_test ? 1 : 0,
        String(row.status), toSql(row.http_status), toSql(row.events_received), toSql(row.fbtrace_id),
        toSql(row.error_message), JSON.stringify(row.payload ?? null), JSON.stringify(row.response ?? null), nowIso()
      );
    return id;
  },
  countSent(leadId, eventName) {
    const r = db()
      .prepare("select count(*) as c from events where lead_id = ? and event_name = ? and status = 'enviado' and is_test = 0")
      .get(leadId, eventName) as Row;
    return Number(r.c);
  },
  sentForLeads(leadIds) {
    const out = new Map<string, EventRow[]>();
    if (leadIds.length === 0) return out;
    const rows = db()
      .prepare(
        `select * from events where status = 'enviado' and is_test = 0 and lead_id in (${leadIds.map(() => "?").join(",")}) order by created_at`
      )
      .all(...leadIds) as Row[];
    for (const r of rows) {
      const ev = toEvent(r);
      out.set(ev.lead_id, [...(out.get(ev.lead_id) || []), ev]);
    }
    return out;
  },
  recentSent(sinceIso) {
    return (
      db()
        .prepare("select event_name, value from events where status = 'enviado' and is_test = 0 and created_at >= ?")
        .all(sinceIso) as Row[]
    ).map((r) => ({ event_name: String(r.event_name), value: num(r.value) }));
  },
  contentNames(clientId) {
    const rows = db()
      .prepare(
        "select content_name, count(*) as c from events where client_id = ? and content_name is not null and content_name <> '' group by content_name order by c desc limit 30"
      )
      .all(clientId) as Row[];
    return rows.map((r) => String(r.content_name));
  },

  getAd(clientId, adId) {
    const r = db().prepare("select * from ad_cache where client_id = ? and ad_id = ?").get(clientId, adId) as Row | undefined;
    return r ? toAd(r) : null;
  },
  adsFor(pairs) {
    const out = new Map();
    const adIds = [...new Set(pairs.map((p) => p.adId))];
    if (adIds.length === 0) return out;
    const rows = db()
      .prepare(`select * from ad_cache where ad_id in (${adIds.map(() => "?").join(",")})`)
      .all(...adIds) as Row[];
    for (const r of rows) {
      const ad = toAd(r);
      out.set(`${ad.client_id}:${ad.ad_id}`, ad);
    }
    return out;
  },
  upsertAd(row) {
    const sets = AD_COLS.map((c) => `${c} = excluded.${c}`).join(", ");
    db()
      .prepare(
        `insert into ad_cache (client_id, ad_id, ${AD_COLS.join(", ")}, fetched_at)
         values (?, ?, ${AD_COLS.map(() => "?").join(", ")}, ?)
         on conflict (client_id, ad_id) do update set ${sets}, fetched_at = excluded.fetched_at`
      )
      .run(
        String(row.client_id), String(row.ad_id),
        ...AD_COLS.map((c) => (c === "raw" ? JSON.stringify(row.raw ?? null) : toSql(row[c]))),
        nowIso()
      );
  },

  getSetting(key) {
    const r = db().prepare("select value from settings where key = ?").get(key) as Row | undefined;
    return r ? String(r.value) : null;
  },
  setSettings(values) {
    const stmt = db().prepare("insert into settings (key, value) values (?, ?) on conflict (key) do update set value = excluded.value");
    for (const [k, v] of Object.entries(values)) stmt.run(k, v);
  },

  stats() {
    const c = (sql: string) => Number((db().prepare(sql).get() as Row).c);
    let dbBytes: number | null = null;
    try {
      dbBytes = fs.statSync(dbPath()).size;
    } catch {
      dbBytes = null;
    }
    return {
      clients: c("select count(*) as c from clients"),
      leads: c("select count(*) as c from leads"),
      events: c("select count(*) as c from events"),
      dbBytes,
    };
  },
  isUniqueViolation(e) {
    return e instanceof Error && /UNIQUE constraint failed/i.test(e.message);
  },
};
