"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { login, logout, requireAuth, startSession } from "@/lib/auth";
import { appSecret, hasPassword, setPassword, verifyPassword } from "@/lib/config";
import { decrypt, encrypt } from "@/lib/crypto";
import { decodeCsv, parseCsv, rowsToRecords } from "@/lib/csv";
import { metaApiVersion } from "@/lib/env";
import { ingestMany } from "@/lib/ingest";
import { buildEvent, fetchAd, sendEvent } from "@/lib/meta";
import { normalizePhone, parseMoney, ufFromPhone } from "@/lib/normalize";
import {
  countSent,
  deleteLead,
  findLead,
  getClient,
  getEvent,
  getLead,
  insertClient,
  insertEvent,
  insertLead,
  isUniqueViolation,
  updateClient,
  updateLead,
  upsertAd,
} from "@/lib/store";
import { MESSAGING_EVENTS, type FormState } from "@/lib/types";
import { THEME_COOKIE, prefsFromForm, serializePrefs } from "@/lib/theme";

const text = (fd: FormData, name: string): string | null => {
  const v = fd.get(name);
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
};

// ---------------------------------------------------------------------------
// Senha e login
// ---------------------------------------------------------------------------

export async function setupPasswordAction(_prev: FormState, fd: FormData): Promise<FormState> {
  if (await hasPassword()) redirect("/login");
  const password = String(fd.get("password") || "");
  const confirm = String(fd.get("confirm") || "");
  if (password.length < 6) return { error: "Use pelo menos 6 caracteres." };
  if (password !== confirm) return { error: "As duas senhas não são iguais." };
  await setPassword(password);
  await startSession();
  redirect("/");
}

export async function loginAction(_prev: FormState, fd: FormData): Promise<FormState> {
  if (!(await hasPassword())) redirect("/login");
  const ok = await login(String(fd.get("password") || ""));
  if (!ok) return { error: "Senha incorreta." };
  redirect("/");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}

/** Aparência (tema, cor, densidade, títulos): fica num cookie de um ano. */
export async function saveThemeAction(fd: FormData): Promise<void> {
  await requireAuth();
  const prefs = prefsFromForm(fd);
  const h = await headers();
  const https = (h.get("x-forwarded-proto") || "").split(",")[0].trim() === "https";
  const jar = await cookies();
  jar.set(THEME_COOKIE, serializePrefs(prefs), {
    httpOnly: true,
    secure: https,
    sameSite: "lax",
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
  });
  revalidatePath("/", "layout");
}

export async function changePasswordAction(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireAuth();
  const current = String(fd.get("current") || "");
  const password = String(fd.get("password") || "");
  const confirm = String(fd.get("confirm") || "");
  if (!(await verifyPassword(current))) return { error: "A senha atual está errada." };
  if (password.length < 6) return { error: "A nova senha precisa de pelo menos 6 caracteres." };
  if (password !== confirm) return { error: "As duas senhas novas não são iguais." };
  await setPassword(password);
  redirect("/configuracoes?salvo=1");
}

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

export async function saveClientAction(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireAuth();
  const id = text(fd, "id");
  const name = text(fd, "name");
  if (!name) return { error: "Informe o nome do cliente." };

  const idMode = text(fd, "id_mode") === "waba" ? "waba" : "page";
  let adAccount = text(fd, "ad_account_id");
  if (adAccount && /^\d+$/.test(adAccount)) adAccount = `act_${adAccount}`;

  const row: Record<string, unknown> = {
    name,
    pixel_id: text(fd, "pixel_id"),
    page_id: text(fd, "page_id"),
    waba_id: text(fd, "waba_id"),
    id_mode: idMode,
    ad_account_id: adAccount,
    test_event_code: text(fd, "test_event_code"),
    default_currency: (text(fd, "default_currency") || "BRL").toUpperCase(),
    send_extra_data: fd.get("send_extra_data") === "on",
  };

  for (const field of ["pixel_id", "page_id", "waba_id"] as const) {
    const v = row[field] as string | null;
    if (v && !/^\d+$/.test(v)) return { error: `O campo ${field} deve ter só números.` };
  }

  // Token em branco = manter o que já está salvo.
  const secret = await appSecret();
  const capi = text(fd, "capi_token");
  if (capi) row.capi_token_enc = encrypt(capi, secret);
  const marketing = text(fd, "marketing_token");
  if (marketing) row.marketing_token_enc = encrypt(marketing, secret);

  let savedId: string;
  try {
    if (id) {
      await updateClient(id, row);
      savedId = id;
    } else {
      savedId = await insertClient(row);
    }
  } catch (e) {
    return { error: `Não foi possível salvar: ${e instanceof Error ? e.message : String(e)}` };
  }
  revalidatePath("/clientes");
  redirect(`/clientes/${savedId}?salvo=1`);
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export async function saveLeadAction(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireAuth();
  const id = text(fd, "id");
  const clientId = text(fd, "client_id");
  const phone = normalizePhone(text(fd, "phone"));
  if (!clientId) return { error: "Escolha o cliente." };
  if (!phone) return { error: "Telefone inválido. Use DDD + número, com ou sem o 55." };

  const state = text(fd, "state");
  if (state && !/^[a-zA-Z]{2}$/.test(state)) return { error: "Estado deve ser a sigla com 2 letras (ex.: CE)." };

  const nowIso = new Date().toISOString();
  const row: Record<string, unknown> = {
    client_id: clientId,
    name: text(fd, "name"),
    phone,
    email: text(fd, "email"),
    city: text(fd, "city"),
    state: state ? state.toUpperCase() : id ? null : ufFromPhone(phone),
    zip: text(fd, "zip"),
    ctwa_clid: text(fd, "ctwa_clid"),
    source_id: text(fd, "source_id"),
    source_url: text(fd, "source_url"),
    thumbnail_url: text(fd, "thumbnail_url"),
    media_url: text(fd, "media_url"),
    notes: text(fd, "notes"),
  };

  let savedId: string;
  try {
    if (id) {
      const old = await getLead(id);
      if (row.ctwa_clid && row.ctwa_clid !== old?.ctwa_clid) row.clid_seen_at = nowIso;
      await updateLead(id, row);
      savedId = id;
    } else {
      if (row.ctwa_clid) row.clid_seen_at = nowIso;
      savedId = await insertLead({ ...row, origin: "manual", first_seen_at: nowIso });
    }
  } catch (e) {
    if (isUniqueViolation(e)) {
      const dup = await findLead(clientId, phone);
      return { error: `Já existe um lead com este telefone neste cliente${dup ? ` (${dup.name || "sem nome"})` : ""}.` };
    }
    return { error: `Não foi possível salvar: ${e instanceof Error ? e.message : String(e)}` };
  }
  revalidatePath("/");
  revalidatePath(`/leads/${savedId}`);
  redirect(id ? `/leads/${savedId}?salvo=1` : `/leads/${savedId}`);
}

export async function deleteLeadAction(fd: FormData) {
  await requireAuth();
  const id = text(fd, "id");
  if (id) await deleteLead(id);
  revalidatePath("/");
  // Volta para a lista de onde veio (com os mesmos filtros), nunca para fora do painel.
  const back = text(fd, "back") || "";
  redirect(/^\/(?!\/)/.test(back) ? back : "/");
}

// ---------------------------------------------------------------------------
// Importação de CSV (exportado da Leona ou qualquer planilha com telefone)
// ---------------------------------------------------------------------------

export interface ImportState {
  error: string | null;
  result: {
    total: number;
    created: number;
    updated: number;
    skipped: number;
    mapped: string[];
    ignored: string[];
    problems: string[];
  } | null;
}

export async function importCsvAction(_prev: ImportState, fd: FormData): Promise<ImportState> {
  await requireAuth();
  const clientId = text(fd, "client_id");
  if (!clientId || !(await getClient(clientId))) return { error: "Escolha o cliente.", result: null };
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Escolha o arquivo CSV.", result: null };
  if (file.size > 4 * 1024 * 1024) return { error: "Arquivo grande demais (limite de 4 MB). Divida a planilha em partes.", result: null };

  const textCsv = decodeCsv(new Uint8Array(await file.arrayBuffer()));
  const rows = parseCsv(textCsv);
  if (rows.length < 2) return { error: "O arquivo não tem linhas de dados.", result: null };
  const { records, mapping } = rowsToRecords(rows);
  const mapped = [...mapping.columns.values()];
  if (!mapped.includes("phone")) {
    return {
      error: `Não achei a coluna do telefone. Colunas do arquivo: ${rows[0].join(", ")}`,
      result: null,
    };
  }

  let bulk;
  try {
    bulk = await ingestMany(clientId, records);
  } catch (e) {
    return { error: `A importação falhou no banco: ${e instanceof Error ? e.message : String(e)}`, result: null };
  }
  const result = { ...bulk, mapped, ignored: mapping.ignored };

  revalidatePath("/");
  return { error: null, result };
}

// ---------------------------------------------------------------------------
// Envio de eventos
// ---------------------------------------------------------------------------

export interface EventFormInput {
  leadId: string;
  eventName: string;
  /** ISO 8601, já convertido no navegador a partir do horário local. */
  eventTimeIso: string;
  value: string;
  currency: string;
  contentName: string;
}

export interface EventPreview {
  ok: boolean;
  errors: string[];
  warnings: string[];
  payload: Record<string, unknown> | null;
  isTest: boolean;
  alreadySent: number;
}

export interface EventSendResult extends EventPreview {
  sent: boolean;
  message: string;
}

async function prepare(input: EventFormInput, eventId: string) {
  const lead = await getLead(input.leadId);
  if (!lead) return null;
  const client = await getClient(lead.client_id);
  if (!client) return null;

  const extraErrors: string[] = [];
  if (!MESSAGING_EVENTS.some((e) => e.value === input.eventName)) extraErrors.push("Evento desconhecido.");
  if (!client.pixel_id) extraErrors.push("Cadastre o ID do pixel (dataset) neste cliente.");
  if (!client.capi_token_enc) extraErrors.push("Cadastre o token da API de Conversões neste cliente.");

  const rawValue = input.value.trim();
  const value = rawValue ? parseMoney(rawValue) : null;
  if (rawValue && value === null) extraErrors.push("Valor inválido.");

  const built = buildEvent({
    client,
    lead,
    eventName: input.eventName,
    eventId,
    eventTime: new Date(input.eventTimeIso),
    value,
    currency: input.currency || client.default_currency,
    contentName: input.contentName,
  });

  const alreadySent = await countSent(lead.id, String(built.event.event_name));
  return { lead, client, built, value, errors: [...extraErrors, ...built.errors], alreadySent };
}

export async function previewEventAction(input: EventFormInput): Promise<EventPreview> {
  await requireAuth();
  const p = await prepare(input, "(gerado no envio)");
  if (!p) return { ok: false, errors: ["Lead não encontrado."], warnings: [], payload: null, isTest: false, alreadySent: 0 };
  return {
    ok: p.errors.length === 0,
    errors: p.errors,
    warnings: p.built.warnings,
    payload: p.built.event,
    isTest: !!p.client.test_event_code,
    alreadySent: p.alreadySent,
  };
}

async function sendAndRecord(input: EventFormInput, eventId: string): Promise<EventSendResult> {
  const p = await prepare(input, eventId);
  if (!p) {
    return { ok: false, sent: false, message: "Lead não encontrado.", errors: ["Lead não encontrado."], warnings: [], payload: null, isTest: false, alreadySent: 0 };
  }
  const base = {
    errors: p.errors,
    warnings: p.built.warnings,
    payload: p.built.event,
    isTest: !!p.client.test_event_code,
    alreadySent: p.alreadySent,
  };
  if (p.errors.length > 0) return { ...base, ok: false, sent: false, message: "Corrija os problemas antes de enviar." };

  let token: string;
  try {
    token = decrypt(p.client.capi_token_enc!, await appSecret());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ...base, ok: false, sent: false, errors: [msg], message: msg };
  }

  const result = await sendEvent({
    apiVersion: metaApiVersion(),
    pixelId: p.client.pixel_id!,
    accessToken: token,
    event: p.built.event,
    testEventCode: p.client.test_event_code,
  });

  const custom = (p.built.event.custom_data || {}) as Record<string, unknown>;
  await insertEvent({
    client_id: p.client.id,
    lead_id: p.lead.id,
    event_name: String(p.built.event.event_name),
    event_id: eventId,
    event_time: new Date(input.eventTimeIso).toISOString(),
    value: p.value,
    currency: (custom.currency as string) ?? null,
    content_name: input.contentName.trim() || null,
    action_source: p.built.actionSource,
    is_test: base.isTest,
    status: result.ok ? "enviado" : "erro",
    http_status: result.httpStatus,
    events_received: result.eventsReceived,
    fbtrace_id: result.fbtraceId,
    error_message: result.errorMessage,
    payload: result.body,
    response: result.response,
  });

  revalidatePath(`/leads/${p.lead.id}`);
  revalidatePath("/eventos");
  revalidatePath("/");

  return {
    ...base,
    ok: result.ok,
    sent: result.ok,
    message: result.ok
      ? base.isTest
        ? "Evento de teste recebido pelo Meta. Confira na aba Eventos de Teste."
        : "Evento recebido pelo Meta."
      : result.errorMessage || "O Meta não confirmou o recebimento.",
  };
}

export async function sendEventAction(input: EventFormInput): Promise<EventSendResult> {
  await requireAuth();
  return sendAndRecord(input, randomUUID());
}

/**
 * Reenvia um evento que deu erro, com o mesmo event_id: se o Meta por acaso
 * já tiver recebido a primeira tentativa, ele descarta a repetição.
 */
export async function resendEventAction(fd: FormData) {
  await requireAuth();
  const id = text(fd, "event_id");
  if (!id) return;
  const ev = await getEvent(id);
  if (!ev || ev.status !== "erro") return;
  await sendAndRecord(
    {
      leadId: ev.lead_id,
      eventName: ev.event_name === "Lead" ? "LeadSubmitted" : ev.event_name,
      eventTimeIso: ev.event_time,
      value: ev.value !== null ? String(ev.value) : "",
      currency: ev.currency || "",
      contentName: ev.content_name || "",
    },
    ev.event_id
  );
}

// ---------------------------------------------------------------------------
// Dados do anúncio
// ---------------------------------------------------------------------------

export async function refreshAdAction(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireAuth();
  const leadId = text(fd, "lead_id");
  if (!leadId) return { error: "Lead não informado." };
  const lead = await getLead(leadId);
  const client = lead ? await getClient(lead.client_id) : null;
  if (!lead || !client) return { error: "Lead não encontrado." };
  if (!lead.source_id) return { error: "Este lead não tem ID de origem (ID do anúncio)." };
  if (!client.marketing_token_enc) {
    return { error: "Cadastre no cliente o token de leitura dos anúncios (permissão ads_read)." };
  }

  let token: string;
  try {
    token = decrypt(client.marketing_token_enc, await appSecret());
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  const res = await fetchAd({ apiVersion: metaApiVersion(), adId: lead.source_id, accessToken: token });
  if (!res.ok) return { error: res.error };

  await upsertAd({ client_id: client.id, ad_id: lead.source_id, ...res.ad });
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/");
  return { error: null };
}
