import "server-only";
import fs from "node:fs";
import { describeDatabaseUrl } from "./db-url";
import { SUPABASE_SETUP_SQL } from "./schema-sql";
import { checkConnection, databaseUrl, pgStore } from "./store-pg";
import { checkRest, restConfig, restStore } from "./store-rest";
import { dataDir, dbPath, sqliteStore } from "./store-sqlite";
import type { EventWithNames, LeadFilter, Row, Stats, StoreImpl } from "./store-rows";
import type { AdInfo, Client, EventRow, Lead } from "./types";

export type { EventWithNames, LeadFilter, Row, Stats } from "./store-rows";

/**
 * Fachada do armazenamento. Escolhe o modo pelo ambiente:
 *  - DATABASE_URL definida                 -> Postgres direto (Supabase, Neon…)
 *  - SUPABASE_DATABASE_URL + SERVICE_ROLE  -> API do Supabase (extensão do Netlify)
 *  - nada disso                            -> arquivo SQLite em data/, no computador
 */

export type StoreKind = "sqlite" | "postgres" | "supabase-rest";

export function storeKind(): StoreKind {
  if (databaseUrl()) return "postgres";
  if (restConfig()) return "supabase-rest";
  return "sqlite";
}

export function isOnline(): boolean {
  return storeKind() !== "sqlite";
}

function impl(): StoreImpl {
  // Os módulos são só de servidor e não abrem conexão até a primeira chamada,
  // então importar todos custa nada e evita truques com require dinâmico.
  switch (storeKind()) {
    case "postgres":
      return pgStore;
    case "supabase-rest":
      return restStore;
    default:
      return sqliteStore;
  }
}

// Clientes
export const listClients = (): Promise<Client[]> => Promise.resolve(impl().listClients());
export const getClient = (id: string): Promise<Client | null> => Promise.resolve(impl().getClient(id));
export const getClientByWebhookKey = (key: string): Promise<Client | null> => Promise.resolve(impl().getClientByWebhookKey(key));
export const insertClient = (row: Row): Promise<string> => Promise.resolve(impl().insertClient(row));
export const updateClient = (id: string, patch: Row): Promise<void> => Promise.resolve(impl().updateClient(id, patch));

// Leads
export const getLead = (id: string): Promise<Lead | null> => Promise.resolve(impl().getLead(id));
export const findLead = (clientId: string, phone: string): Promise<Lead | null> => Promise.resolve(impl().findLead(clientId, phone));
export const findLeadsByPhones = (clientId: string, phones: string[]): Promise<Lead[]> => Promise.resolve(impl().findLeadsByPhones(clientId, phones));
export const listLeads = (f: LeadFilter): Promise<Lead[]> => Promise.resolve(impl().listLeads(f));
export const insertLead = (row: Row): Promise<string> => Promise.resolve(impl().insertLead(row));
export const insertLeads = (rows: Row[]): Promise<number> => Promise.resolve(impl().insertLeads(rows));
export const updateLead = (id: string, patch: Row): Promise<void> => Promise.resolve(impl().updateLead(id, patch));
export const updateLeadsBulk = (rows: Row[]): Promise<number> => Promise.resolve(impl().updateLeadsBulk(rows));
export const deleteLead = (id: string): Promise<void> => Promise.resolve(impl().deleteLead(id));

// Eventos
export const listEventsForLead = (leadId: string): Promise<EventRow[]> => Promise.resolve(impl().listEventsForLead(leadId));
export const listEvents = (f: { status?: string; offset: number; limit: number }): Promise<EventWithNames[]> => Promise.resolve(impl().listEvents(f));
export const getEvent = (id: string): Promise<EventRow | null> => Promise.resolve(impl().getEvent(id));
export const insertEvent = (row: Row): Promise<string> => Promise.resolve(impl().insertEvent(row));
export const countSent = (leadId: string, eventName: string): Promise<number> => Promise.resolve(impl().countSent(leadId, eventName));
export const sentForLeads = (leadIds: string[]): Promise<Map<string, EventRow[]>> => Promise.resolve(impl().sentForLeads(leadIds));
export const recentSent = (sinceIso: string): Promise<{ event_name: string; value: number | null }[]> => Promise.resolve(impl().recentSent(sinceIso));
export const contentNames = (clientId: string): Promise<string[]> => Promise.resolve(impl().contentNames(clientId));

// Anúncios
export const getAd = (clientId: string, adId: string): Promise<AdInfo | null> => Promise.resolve(impl().getAd(clientId, adId));
export const adsFor = (pairs: { clientId: string; adId: string }[]): Promise<Map<string, AdInfo>> => Promise.resolve(impl().adsFor(pairs));
export const upsertAd = (row: Row): Promise<void> => Promise.resolve(impl().upsertAd(row));

// Configuração guardada no banco (modo online)
export const getSetting = (key: string): Promise<string | null> => Promise.resolve(impl().getSetting(key));
export const setSettings = (values: Record<string, string>): Promise<void> => Promise.resolve(impl().setSettings(values));

export const stats = (): Promise<Stats> => Promise.resolve(impl().stats());
export const isUniqueViolation = (e: unknown): boolean => impl().isUniqueViolation(e);

/** Caminhos do modo local (para a tela de Configurações). */
export function localPaths(): { db: string; config: string } | null {
  if (isOnline()) return null;
  return { db: dbPath(), config: `${dataDir()}/config.json` };
}

/**
 * No modo local o painel precisa gravar na pasta data/. Em servidores sem disco
 * (Netlify, Vercel) isso não existe: o que se quer lá é o modo online.
 * Devolve uma explicação quando o painel não tem onde guardar os dados.
 */
export function storageProblem(): string | null {
  if (isOnline()) return null;
  const serverless = !!(process.env.NETLIFY || process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  try {
    const dir = dataDir();
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    return serverless
      ? "O painel está publicado em um servidor sem disco, então precisa de um banco de dados na internet. No Netlify, instale a extensão do Supabase (Extensions > Supabase > Connect) ou cadastre a variável DATABASE_URL, e faça um novo deploy."
      : "O painel não consegue gravar na pasta de dados. Confira se a pasta do painel tem permissão de escrita ou defina TRACK_DATA_DIR.";
  }
  if (serverless) {
    return "O painel está publicado em um servidor onde os arquivos não ficam guardados. No Netlify, instale a extensão do Supabase (Extensions > Supabase > Connect) ou cadastre a variável DATABASE_URL, e faça um novo deploy.";
  }
  return null;
}

export type SetupProblem = {
  message: string;
  /** Endereço do banco com a senha escondida, para a pessoa conferir o que foi cadastrado. */
  database: string | null;
  /** SQL para colar no Supabase quando as tabelas ainda não existem (modo API). */
  sql?: string;
};

/**
 * Tudo que impede o painel de funcionar: sem lugar para gravar (modo local em
 * servidor sem disco) ou banco que não conecta (modo online). As telas de
 * entrada mostram isso em vez de um erro genérico.
 */
export async function setupProblem(): Promise<SetupProblem | null> {
  const storage = storageProblem();
  if (storage) return { message: storage, database: null };
  const kind = storeKind();
  if (kind === "sqlite") return null;
  if (kind === "supabase-rest") {
    const problem = await checkRest();
    if (!problem) return null;
    const c = restConfig();
    if (problem === "TABELAS_FALTANDO") {
      return {
        message:
          "O painel já fala com o seu projeto do Supabase, mas as tabelas ainda não existem. É uma vez só: no Supabase, abra o SQL Editor (menu da esquerda), cole o texto abaixo e clique em Run. Depois recarregue esta página.",
        database: c?.url ?? null,
        sql: SUPABASE_SETUP_SQL,
      };
    }
    return { message: problem, database: c?.url ?? null };
  }
  const problem = await checkConnection();
  if (!problem) return null;
  return { message: problem, database: describeDatabaseUrl(databaseUrl())?.masked ?? null };
}
