import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import {
  databaseUrlAdvice,
  explainDatabaseError,
  normalizeDatabaseUrl,
} from "./db-url";
import { SCHEMA_SQL } from "./schema-sql";
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
  withDispatchLease,
  type Row,
  type StoreImpl,
} from "./store-rows";
import type { EventRow } from "./types";
import { mergeLeadUpdate } from "./lead-tracking";

/**
 * Modo online: Postgres (Supabase, Neon ou qualquer outro) apontado por DATABASE_URL.
 * As tabelas são criadas sozinhas na primeira conexão.
 */

const SCHEMA = SCHEMA_SQL;

const g = globalThis as unknown as {
  __trackPool?: Pool;
  __trackPoolUrl?: string;
  __trackSchema?: Promise<void>;
  __trackCheck?: { url: string; at: number; problem: string | null };
};

/**
 * String de conexão do Postgres. DATABASE_URL é o nome oficial; os outros são os
 * que plataformas costumam criar sozinhas (Vercel, extensões do Netlify), aceitos
 * só quando de fato contêm uma URL de Postgres.
 */
export function databaseUrl(): string {
  for (const name of [
    "DATABASE_URL",
    "POSTGRES_URL",
    "SUPABASE_DB_URL",
    "SUPABASE_DATABASE_URL",
  ]) {
    const v = normalizeDatabaseUrl(process.env[name]);
    if (!v) continue;
    if (name === "DATABASE_URL" || /^postgres(ql)?:\/\//i.test(v)) return v;
  }
  return "";
}

/**
 * Tenta conectar e criar as tabelas. Devolve null quando está tudo certo ou uma
 * explicação em português do que está errado (senha recusada, endereço errado…).
 * Sucesso fica guardado enquanto o processo viver; falha é tentada de novo a cada 15 s.
 */
export async function checkConnection(): Promise<string | null> {
  const url = databaseUrl();
  if (!url) return "DATABASE_URL não configurada.";
  const advice = databaseUrlAdvice(url);
  if (advice) return advice;
  const c = g.__trackCheck;
  const now = Date.now();
  if (c && c.url === url && (c.problem === null || now - c.at < 15_000))
    return c.problem;
  let problem: string | null = null;
  try {
    await ready();
    await pool().query("select 1");
  } catch (e) {
    problem = explainDatabaseError(e, url);
  }
  g.__trackCheck = { url, at: now, problem };
  return problem;
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
  const local =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "";
  const ssl =
    sslmode === "disable" || local ? undefined : { rejectUnauthorized: true };
  g.__trackPool = new Pool({
    connectionString: url,
    ssl,
    // Funções serverless abrem poucas conexões por instância; o Supabase tem limite.
    max: 3,
    idleTimeoutMillis: 30_000,
    // Abaixo do limite de 10 s das funções do Netlify, para o erro chegar à tela.
    connectionTimeoutMillis: 8_000,
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

async function q<T extends QueryResultRow = Row>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const p = await ready();
  const res = await p.query<T>(sql, params);
  return res.rows;
}

async function one<T extends QueryResultRow = Row>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await q<T>(sql, params);
  return rows[0] ?? null;
}

function toSql(v: unknown): unknown {
  if (v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return v;
}

/** Valor para coluna jsonb: o driver serializa objetos, mas null precisa ser explícito. */
const json = (v: unknown) =>
  v === undefined || v === null ? null : JSON.stringify(v);

async function update(
  table: string,
  id: string,
  patch: Row,
  allowed: readonly string[],
) {
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (keys.length === 0) return;
  const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  const values = keys.map((k) =>
    k === "raw" ? json(patch[k]) : toSql(patch[k]),
  );
  await q(`update ${table} set ${sets} where id = $${keys.length + 1}`, [
    ...values,
    id,
  ]);
}

const LEAD_INSERT_COLS = LEAD_COLS.filter(
  (c) => c !== "updated_at" && c !== "first_seen_at",
);

function leadValues(row: Row, id: string): unknown[] {
  const t = nowIso();
  const withDefaults: Row = {
    ...row,
    country: row.country || "br",
    origin: row.origin || "manual",
  };
  return [
    id,
    ...LEAD_INSERT_COLS.map((c) =>
      c === "raw" ? json(withDefaults.raw) : toSql(withDefaults[c]),
    ),
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
    return (await q("select * from clients order by lower(name)")).map(
      toClient,
    );
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
        id,
        String(row.name),
        randomBytes(24).toString("hex"),
        toSql(row.pixel_id),
        toSql(row.capi_token_enc),
        toSql(row.page_id),
        toSql(row.waba_id),
        String(row.id_mode || "page"),
        toSql(row.ad_account_id),
        toSql(row.marketing_token_enc),
        toSql(row.test_event_code),
        String(row.default_currency || "BRL"),
        row.send_extra_data !== false,
        t,
        t,
      ],
    );
    return id;
  },
  async updateClient(id, patch) {
    await update(
      "clients",
      id,
      { ...patch, updated_at: nowIso() },
      CLIENT_COLS,
    );
  },

  async getLead(id) {
    const r = await one("select * from leads where id = $1", [id]);
    return r ? toLead(r) : null;
  },
  async findLead(clientId, phone) {
    const r = await one(
      "select * from leads where client_id = $1 and phone = $2",
      [clientId, phone],
    );
    return r ? toLead(r) : null;
  },
  async findLeadsByPhones(clientId, phones) {
    if (phones.length === 0) return [];
    return (
      await q(
        "select * from leads where client_id = $1 and phone = any($2::text[])",
        [clientId, phones],
      )
    ).map(toLead);
  },
  async listLeads(f) {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (f.clientId) where.push(`client_id = ${add(f.clientId)}`);
    const realClick =
      "(ctwa_clid is not null and trim(ctwa_clid) <> '' and left(ctwa_clid, 8) <> 'ctwa_ad_' and left(ctwa_clid, 3) <> 'ad_')";
    if (f.filter === "com-ctwa") where.push(realClick);
    if (f.filter === "sem-ctwa") where.push(`not ${realClick}`);
    const purchase =
      "exists (select 1 from events e where e.lead_id = leads.id and e.client_id = leads.client_id and e.event_name = 'Purchase' and e.status = 'enviado' and e.is_test = false)";
    if (f.filter === "com-venda") where.push(purchase);
    if (f.filter === "sem-venda") where.push(`not ${purchase}`);
    const text = (f.q || "").trim();
    if (text) {
      const digits = text.replace(/\D/g, "");
      const parts = [
        `name ilike ${add(`%${text.replace(/[\\%_]/g, "\\$&")}%`)}`,
        `source_id = ${add(digits || "-")}`,
      ];
      if (digits.length >= 4) parts.push(`phone like ${add(`%${digits}%`)}`);
      where.push(`(${parts.join(" or ")})`);
    }
    const sql = `select * from leads ${where.length ? "where " + where.join(" and ") : ""} order by updated_at desc limit ${add(f.limit)} offset ${add(f.offset)}`;
    return (await q(sql, params)).map(toLead);
  },
  async insertLead(row) {
    const id = randomUUID();
    const width = LEAD_INSERT_COLS.length + 3; // id + colunas + first_seen_at + updated_at
    const placeholders = Array.from(
      { length: width },
      (_, k) => `$${k + 1}`,
    ).join(", ");
    await q(
      `insert into leads (id, ${LEAD_INSERT_COLS.join(", ")}, first_seen_at, updated_at) values (${placeholders})`,
      leadValues(row, id),
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
            values,
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
    if (patch.client_id !== undefined) {
      const existing = await pgStore.getLead(id);
      if (
        existing &&
        patch.client_id !== existing.client_id &&
        (await pgStore.listEventsForLead(id)).length
      )
        throw new Error(
          "Não é possível mover um lead com histórico de eventos para outro cliente.",
        );
    }
    await update("leads", id, { ...patch, updated_at: nowIso() }, LEAD_COLS);
  },
  async updateLeadWithRaw(id, patch, incomingRaw) {
    await withClient(async (c) => {
      await c.query("begin");
      try {
        const current = (
          await c.query<Row>("select * from leads where id = $1 for update", [
            id,
          ])
        ).rows[0];
        if (!current) throw new Error("Lead não encontrado.");
        const at = nowIso();
        const full = mergeLeadUpdate(current, patch, incomingRaw, at);
        const keys = Object.keys(full).filter((key) =>
          (LEAD_COLS as readonly string[]).includes(key),
        );
        const values = keys.map((key) =>
          key === "raw"
            ? json(full[key as keyof typeof full])
            : toSql(full[key as keyof typeof full]),
        );
        await c.query(
          `update leads set ${keys.map((key, i) => `${key} = $${i + 1}`).join(", ")} where id = $${keys.length + 1}`,
          [...values, id],
        );
        await c.query("commit");
      } catch (error) {
        await c.query("rollback");
        throw error;
      }
    });
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
            values,
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
    return (
      await q(
        "select * from events where lead_id = $1 order by created_at desc",
        [leadId],
      )
    ).map(toEvent);
  },
  async listEvents(f) {
    const filtered = f.status === "enviado" || f.status === "erro";
    const rows = await q(
      `select e.*, l.name as lead_name, l.phone as lead_phone, c.name as client_name
       from events e left join leads l on l.id = e.lead_id left join clients c on c.id = e.client_id
       ${filtered ? "where e.status = $3" : ""} order by e.created_at desc limit $1 offset $2`,
      filtered ? [f.limit, f.offset, f.status] : [f.limit, f.offset],
    );
    return rows.map((r) => ({
      ...toEvent(r),
      lead_name: str(r.lead_name),
      lead_phone: str(r.lead_phone),
      client_name: str(r.client_name),
    }));
  },
  async getEvent(id) {
    const r = await one("select * from events where id = $1", [id]);
    return r ? toEvent(r) : null;
  },
  async getEventByExternalId(clientId, eventId) {
    const row = await one(
      "select * from events where client_id = $1 and event_id = $2 order by created_at desc limit 1",
      [clientId, eventId],
    );
    return row ? toEvent(row) : null;
  },
  async insertEvent(row) {
    const previous = await pgStore.getEventByExternalId(
      String(row.client_id),
      String(row.event_id),
    );
    if (previous) return previous.id;
    const id = await pgStore.getOrCreateSetting(
      `conversion:${row.client_id}:${row.event_id}`,
      randomUUID(),
    );
    const lead = await pgStore.getLead(String(row.lead_id));
    if (!lead || lead.client_id !== row.client_id)
      throw new Error("O lead não pertence ao cliente do evento.");
    await q(
      `insert into events (id, client_id, lead_id, event_name, event_id, event_time, value, currency, content_name,
         action_source, is_test, status, http_status, events_received, fbtrace_id, error_message, payload, response, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) on conflict (id) do nothing`,
      [
        id,
        String(row.client_id),
        String(row.lead_id),
        String(row.event_name),
        String(row.event_id),
        String(row.event_time),
        toSql(row.value),
        toSql(row.currency),
        toSql(row.content_name),
        String(row.action_source),
        !!row.is_test,
        String(row.status),
        toSql(row.http_status),
        toSql(row.events_received),
        toSql(row.fbtrace_id),
        toSql(row.error_message),
        JSON.stringify(row.payload ?? null),
        JSON.stringify(row.response ?? null),
        nowIso(),
      ],
    );
    return id;
  },
  async updateEvent(id, patch) {
    const allowed = [
      "status",
      "http_status",
      "events_received",
      "fbtrace_id",
      "error_message",
      "response",
    ];
    const keys = Object.keys(patch).filter((key) => allowed.includes(key));
    if (!keys.length) return;
    await q(
      `update events set ${keys.map((key, i) => `${key} = $${i + 1}`).join(", ")} where id = $${keys.length + 1}`,
      [
        ...keys.map((key) =>
          key === "response" ? json(patch[key]) : toSql(patch[key]),
        ),
        id,
      ],
    );
  },
  async claimEvent(id) {
    const row = await one("select response from events where id = $1", [id]);
    if (!row) return false;
    const cutoff = new Date(Date.now() - 120_000).toISOString();
    return (
      (
        await q(
          "update events set status = 'enviando', response = $2::jsonb where id = $1 and (status in ('pendente', 'erro', 'incerto') or (status = 'enviando' and response->'request_context'->>'dispatch_started_at' < $3)) returning id",
          [id, JSON.stringify(withDispatchLease(row.response)), cutoff],
        )
      ).length === 1
    );
  },
  async countSent(leadId, eventName) {
    const r = await one(
      "select count(*)::int as c from events where lead_id = $1 and event_name = $2 and status = 'enviado' and is_test = false",
      [leadId, eventName],
    );
    return Number(r?.c ?? 0);
  },
  async sentForLeads(leadIds) {
    const out = new Map<string, EventRow[]>();
    if (leadIds.length === 0) return out;
    const rows = await q(
      "select * from events where status = 'enviado' and is_test = false and lead_id = any($1::text[]) order by created_at",
      [leadIds],
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
      [sinceIso],
    );
    return rows.map((r) => ({
      event_name: String(r.event_name),
      value: num(r.value),
    }));
  },
  async contentNames(clientId) {
    const rows = await q(
      "select content_name, count(*) as c from events where client_id = $1 and content_name is not null and content_name <> '' group by content_name order by c desc limit 30",
      [clientId],
    );
    return rows.map((r) => String(r.content_name));
  },

  async getAd(clientId, adId) {
    const r = await one(
      "select * from ad_cache where client_id = $1 and ad_id = $2",
      [clientId, adId],
    );
    return r ? toAd(r) : null;
  },
  async adsFor(pairs) {
    const out = new Map();
    const adIds = [...new Set(pairs.map((p) => p.adId))];
    if (adIds.length === 0) return out;
    const rows = await q(
      "select * from ad_cache where ad_id = any($1::text[])",
      [adIds],
    );
    for (const r of rows) {
      const ad = toAd(r);
      out.set(`${ad.client_id}:${ad.ad_id}`, ad);
    }
    return out;
  },
  async upsertAd(row) {
    const cols = AD_COLS.filter(
      (c) => Object.hasOwn(row, c) && row[c] !== undefined,
    );
    const sets = cols.map((c) => `${c} = excluded.${c}`);
    await q(
      `insert into ad_cache (client_id, ad_id${cols.length ? ", " + cols.join(", ") : ""}, fetched_at)
       values ($1, $2${cols.length ? ", " + cols.map((_, i) => `$${i + 3}`).join(", ") : ""}, $${cols.length + 3})
       on conflict (client_id, ad_id) do update set ${[...sets, "fetched_at = excluded.fetched_at"].join(", ")}`,
      [
        String(row.client_id),
        String(row.ad_id),
        ...cols.map((c) => (c === "raw" ? json(row.raw) : toSql(row[c]))),
        nowIso(),
      ],
    );
  },

  async getSetting(key) {
    const r = await one("select value from settings where key = $1", [key]);
    return r ? String(r.value) : null;
  },
  async getOrCreateSetting(key, value) {
    await q(
      "insert into settings (key, value) values ($1, $2) on conflict (key) do nothing",
      [key, value],
    );
    const winner = await one("select value from settings where key = $1", [
      key,
    ]);
    if (!winner) throw new Error("Não foi possível criar a configuração.");
    return String(winner.value);
  },
  async setSettings(values) {
    await withClient(async (c) => {
      await c.query("begin");
      try {
        for (const [k, v] of Object.entries(values))
          await c.query(
            "insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value",
            [k, v],
          );
        await c.query("commit");
      } catch (error) {
        await c.query("rollback");
        throw error;
      }
    });
  },

  async stats() {
    const r = await one(
      "select (select count(*) from clients)::int as clients, (select count(*) from leads)::int as leads, (select count(*) from events)::int as events",
    );
    return {
      clients: Number(r?.clients ?? 0),
      leads: Number(r?.leads ?? 0),
      events: Number(r?.events ?? 0),
      dbBytes: null,
    };
  },
  isUniqueViolation(e) {
    return (
      !!e && typeof e === "object" && (e as { code?: string }).code === "23505"
    );
  },
};
