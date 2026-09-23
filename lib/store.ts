import "server-only";
import fs from "node:fs";
import { pgStore } from "./store-pg";
import { dataDir, dbPath, sqliteStore } from "./store-sqlite";
import type { EventWithNames, LeadFilter, Row, Stats, StoreImpl } from "./store-rows";
import type { AdInfo, Client, EventRow, Lead } from "./types";

export type { EventWithNames, LeadFilter, Row, Stats } from "./store-rows";

/**
 * Fachada do armazenamento. Escolhe o modo pelo ambiente:
 *  - DATABASE_URL definida  -> Postgres (Supabase, Neon…), para o painel na internet
 *  - sem DATABASE_URL       -> arquivo SQLite em data/, para o painel no computador
 */

export function isOnline(): boolean {
  return !!(process.env.DATABASE_URL || "").trim();
}

function impl(): StoreImpl {
  // Os dois módulos são só de servidor e não abrem conexão até a primeira chamada,
  // então importar ambos custa nada e evita truques com require dinâmico.
  return isOnline() ? pgStore : sqliteStore;
}

export function storeKind(): "sqlite" | "postgres" {
  return impl().kind;
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
      ? "O painel está publicado em um servidor sem disco, então precisa de um banco de dados na internet. Cadastre a variável DATABASE_URL (string de conexão do Supabase) nas configurações do site e faça um novo deploy."
      : "O painel não consegue gravar na pasta de dados. Confira se a pasta do painel tem permissão de escrita ou defina TRACK_DATA_DIR.";
  }
  if (serverless) {
    return "O painel está publicado em um servidor onde os arquivos não ficam guardados. Cadastre a variável DATABASE_URL (string de conexão do Supabase) nas configurações do site e faça um novo deploy.";
  }
  return null;
}
