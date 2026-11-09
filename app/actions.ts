"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { login, logout, requireAuth, startSession } from "@/lib/auth";
import {
  appSecret,
  hasPassword,
  setInitialPassword,
  setPassword,
  verifyPassword,
} from "@/lib/config";
import { decrypt, encrypt } from "@/lib/crypto";
import { decodeCsv, parseCsv, rowsToRecords } from "@/lib/csv";
import { metaApiVersion } from "@/lib/env";
import {
  evolutionCreateOrConnect,
  evolutionGetState,
  evolutionLogout,
} from "@/lib/evolution";
import {
  wahaCreateOrConnect,
  wahaGetState,
  wahaLogout,
  wahaGetQrCode,
} from "@/lib/waha";
import { enrichAdInRealTime, ingestMany } from "@/lib/ingest";
import {
  buildEvent,
  fetchAd,
  fetchAdAccountCampaigns,
  fetchAdAccountAdsAndInsights,
  sendEvent,
} from "@/lib/meta";
import { normalizePhone, parseMoney, ufFromPhone } from "@/lib/normalize";
import {
  countSent,
  claimEvent,
  getEventByExternalId,
  getOrCreateSetting,
  getSetting,
  setSettings,
  updateEvent,
  deleteLead,
  findLead,
  findLeadsByPhones,
  getClient,
  getEvent,
  getLead,
  insertClient,
  insertEvent,
  insertLead,
  isUniqueViolation,
  listClients,
  listLeads,
  listEventsForLead,
  updateClient,
  updateLead,
  upsertAd,
} from "@/lib/store";
import { MESSAGING_EVENTS, type FormState, type EventRow } from "@/lib/types";
import { THEME_COOKIE, prefsFromForm, serializePrefs } from "@/lib/theme";

const text = (fd: FormData, name: string): string | null => {
  const v = fd.get(name);
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
};

// ---------------------------------------------------------------------------
// Senha e login
// ---------------------------------------------------------------------------

export async function setupPasswordAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  if (await hasPassword()) redirect("/login");
  const password = String(fd.get("password") || "");
  const confirm = String(fd.get("confirm") || "");
  if (password.length < 6) return { error: "Use pelo menos 6 caracteres." };
  if (password !== confirm) return { error: "As duas senhas não são iguais." };
  if (!(await setInitialPassword(password)))
    return {
      error:
        "A senha inicial já está sendo configurada. Atualize a página e entre com a senha cadastrada.",
    };
  await startSession();
  redirect("/");
  throw new Error("unreachable");
}

export async function loginAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  if (!(await hasPassword())) redirect("/login");
  const ok = await login(String(fd.get("password") || ""));
  if (!ok) return { error: "Senha incorreta." };
  redirect("/");
  throw new Error("unreachable");
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
  const https =
    (h.get("x-forwarded-proto") || "").split(",")[0].trim() === "https";
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

export async function changePasswordAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireAuth();
  const current = String(fd.get("current") || "");
  const password = String(fd.get("password") || "");
  const confirm = String(fd.get("confirm") || "");
  if (!(await verifyPassword(current)))
    return { error: "A senha atual está errada." };
  if (password.length < 6)
    return { error: "A nova senha precisa de pelo menos 6 caracteres." };
  if (password !== confirm)
    return { error: "As duas senhas novas não são iguais." };
  await setPassword(password);
  await startSession();
  redirect("/configuracoes?salvo=1");
  throw new Error("unreachable");
}

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

export async function saveClientAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireAuth();
  const id = text(fd, "id");
  const name = text(fd, "name");
  if (!name) return { error: "Informe o nome do cliente." };

  const idMode = text(fd, "id_mode") === "waba" ? "waba" : "page";
  let adAccount = text(fd, "ad_account_id");
  if (adAccount && /^\d+$/.test(adAccount)) adAccount = `act_${adAccount}`;
  if (adAccount && !/^act_\d{1,30}$/.test(adAccount))
    return {
      error:
        "Informe um ID válido da conta de anúncios, com act_ seguido de números.",
    };

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
    if (v && !/^\d+$/.test(v))
      return { error: `O campo ${field} deve ter só números.` };
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
      const previous = await getClient(id);
      await updateClient(id, row);
      if (previous?.ad_account_id !== adAccount)
        await setSettings({
          [`meta_campaign_catalog_${id}`]: "",
          [`meta_synced_ad_ids_${id}`]: "",
        });
      savedId = id;
    } else {
      savedId = await insertClient(row);
    }
  } catch (e) {
    return {
      error: `Não foi possível salvar: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  revalidatePath("/clientes");
  redirect(`/clientes/${savedId}?salvo=1`);
  throw new Error("unreachable");
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export async function saveLeadAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireAuth();
  const id = text(fd, "id");
  const clientId = text(fd, "client_id");
  const phone = normalizePhone(text(fd, "phone"));
  if (!clientId) return { error: "Escolha o cliente." };
  if (!(await getClient(clientId))) return { error: "Cliente não encontrado." };
  if (!phone)
    return { error: "Telefone inválido. Use DDD + número, com ou sem o 55." };
  const state = text(fd, "state");
  if (state && !/^[a-zA-Z]{2}$/.test(state))
    return { error: "Estado deve ser a sigla com 2 letras (ex.: CE)." };
  const { normalizeCtwaClid } = await import("@/lib/ctwa");
  const { TRACKING_FIELDS, withTrackingTouch, mergeLeadUpdate } =
    await import("@/lib/lead-tracking");
  const { updateLeadWithRaw } = await import("@/lib/store");
  const formFields = [
    "ctwa_clid",
    "source_id",
    "source_url",
    "thumbnail_url",
    "media_url",
  ] as const;
  const supplied = formFields.filter((field) => fd.has(field));
  const incoming: Record<string, string | null> = Object.fromEntries(
    formFields.map((field) => [field, text(fd, field)]),
  );
  if (incoming.ctwa_clid) {
    const normalized = normalizeCtwaClid(incoming.ctwa_clid);
    if (!normalized || normalized.length < 10)
      return {
        error:
          "CTWA Click ID inválido. Use somente o identificador real recebido do provedor.",
      };
    incoming.ctwa_clid = normalized;
  }
  if (incoming.source_id && !/^\d{6,}$/.test(incoming.source_id))
    return {
      error:
        "ID do anúncio inválido. Use apenas números, com pelo menos 6 dígitos.",
    };
  const profile: Record<string, unknown> = {
    client_id: clientId,
    name: text(fd, "name"),
    phone,
    email: text(fd, "email"),
    city: text(fd, "city"),
    state: state ? state.toUpperCase() : id ? null : ufFromPhone(phone),
    zip: text(fd, "zip"),
    notes: text(fd, "notes"),
  };
  const now = new Date().toISOString();
  const asFields = (value: Record<string, unknown>) =>
    Object.fromEntries(
      TRACKING_FIELDS.map((key) => [
        key,
        typeof value[key] === "string" && (value[key] as string).trim()
          ? (value[key] as string).trim()
          : null,
      ]),
    ) as Record<string, string | null>;
  let baseline: Record<string, string | null> | null = null;
  if (fd.has("tracking_baseline")) {
    const rawBaseline = text(fd, "tracking_baseline");
    try {
      if (!rawBaseline || rawBaseline.length > 64000)
        throw new Error("invalid");
      const parsed = JSON.parse(rawBaseline);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        TRACKING_FIELDS.some(
          (key) => parsed[key] !== null && typeof parsed[key] !== "string",
        )
      )
        throw new Error("invalid");
      baseline = asFields(parsed);
    } catch {
      return {
        error:
          "A referência do formulário está inválida. Recarregue a página antes de salvar.",
      };
    }
  }
  let savedId: string;
  try {
    if (id) {
      const old = await getLead(id);
      if (!old) return { error: "Lead não encontrado." };
      const changingClient = old.client_id !== clientId;
      if (changingClient && (await listEventsForLead(id)).length > 0)
        return {
          error:
            "Este contato possui histórico de conversões. Não é possível trocar sua empresa; cadastre outro contato na empresa de destino.",
        };
      const current = asFields(old as unknown as Record<string, unknown>);
      const original = baseline || current;
      const changed = supplied.filter((key) => incoming[key] !== original[key]);
      if (changed.length && !baseline)
        return {
          error: "Recarregue o cadastro antes de alterar a origem do contato.",
        };
      if (
        changed.length &&
        TRACKING_FIELDS.some((key) => current[key] !== original[key])
      )
        return {
          error:
            "A origem deste contato mudou enquanto o formulário estava aberto. Recarregue a página e confira o clique antes de salvar.",
        };
      if (!changed.length && !changingClient) {
        // Form inputs may still contain a previous referral. Profile-only saves
        // never write tracking columns, preserving a click received meanwhile.
        await updateLead(id, profile);
      } else {
        const identityChanged =
          changingClient ||
          changed.includes("ctwa_clid") ||
          changed.includes("source_id") ||
          changed.includes("source_url");
        const reference: Record<string, string | null> = identityChanged
          ? Object.fromEntries(TRACKING_FIELDS.map((key) => [key, null]))
          : { ...current };
        for (const key of changed) reference[key] = incoming[key];
        const raw =
          old.raw && typeof old.raw === "object" && !Array.isArray(old.raw)
            ? (old.raw as Record<string, unknown>)
            : {};
        const snapshot =
          raw._tracking_snapshot && typeof raw._tracking_snapshot === "object"
            ? (raw._tracking_snapshot as Record<string, unknown>)
            : {};
        const observed =
          !identityChanged && typeof snapshot.observed_at === "string"
            ? snapshot.observed_at
            : !identityChanged && old.clid_seen_at
              ? old.clid_seen_at
              : now;
        const noReference =
          !reference.ctwa_clid && !reference.source_id && !reference.source_url;
        await updateLeadWithRaw(
          id,
          profile,
          withTrackingTouch(
            { provider: "manual" },
            reference,
            "manual",
            observed,
            { forceNew: true, clear: noReference, expectedFields: current },
          ),
        );
      }
      savedId = id;
    } else {
      const reference = Object.fromEntries(
        TRACKING_FIELDS.map((key) => [key, incoming[key] || null]),
      );
      const prepared = mergeLeadUpdate(
        {},
        { ...profile, origin: "manual", first_seen_at: now },
        withTrackingTouch({}, reference, "manual", now, { forceNew: true }),
        now,
      );
      savedId = await insertLead(prepared);
    }
  } catch (e) {
    if (isUniqueViolation(e)) {
      const dup = await findLead(clientId, phone);
      return {
        error: `Já existe um lead com este telefone neste cliente${dup ? ` (${dup.name || "sem nome"})` : ""}.`,
      };
    }
    return {
      error: `Não foi possível salvar: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  revalidateConversion(savedId);
  redirect(id ? `/leads/${savedId}?salvo=1` : `/leads/${savedId}`);
  throw new Error("unreachable");
}

export async function saveLeadNotesAction(
  leadId: string,
  notes: string,
): Promise<{ ok: boolean; message: string }> {
  await requireAuth();
  if (typeof notes !== "string" || notes.length > 10000)
    return { ok: false, message: "Use até 10.000 caracteres nas anotações." };
  if (!(await getLead(leadId)))
    return { ok: false, message: "Contato não encontrado." };
  await updateLead(leadId, { notes: notes.trim() || null });
  revalidatePath("/conversas");
  revalidatePath(`/leads/${leadId}`);
  return { ok: true, message: "Anotação salva." };
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

export async function importCsvAction(
  _prev: ImportState,
  fd: FormData,
): Promise<ImportState> {
  await requireAuth();
  const clientId = text(fd, "client_id");
  if (!clientId || !(await getClient(clientId)))
    return { error: "Escolha o cliente.", result: null };
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0)
    return { error: "Escolha o arquivo CSV.", result: null };
  if (file.size > 4 * 1024 * 1024)
    return {
      error:
        "Arquivo grande demais (limite de 4 MB). Divida a planilha em partes.",
      result: null,
    };

  const textCsv = decodeCsv(new Uint8Array(await file.arrayBuffer()));
  const rows = parseCsv(textCsv);
  if (rows.length < 2)
    return { error: "O arquivo não tem linhas de dados.", result: null };
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
    return {
      error: `A importação falhou no banco: ${e instanceof Error ? e.message : String(e)}`,
      result: null,
    };
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
  /** Horário ISO da conversão que o operador conferiu. */
  eventTimeIso: string;
  value: string;
  currency: string;
  contentName: string;
  /** Uma chave por intenção de venda, reutilizada em cliques/repetições da mesma intenção. */
  idempotencyKey?: string;
  /** Alias de compatibilidade para clientes antigos. */
  saleKey?: string;
  confirmNewSale?: boolean;
}

export interface EventPreview {
  ok: boolean;
  errors: string[];
  warnings: string[];
  payload: Record<string, unknown> | null;
  isTest: boolean;
  alreadySent: number;
  currency?: string;
}

export interface EventSendResult extends EventPreview {
  sent: boolean;
  message: string;
}

const failedEvent = (
  message: string,
  errors: string[] = [message],
): EventSendResult => ({
  ok: false,
  sent: false,
  message,
  errors,
  warnings: [],
  payload: null,
  isTest: false,
  alreadySent: 0,
});

function eventInputErrors(input: EventFormInput): string[] {
  if (!input || typeof input !== "object") return ["Evento inválido."];
  for (const key of [
    "leadId",
    "eventName",
    "eventTimeIso",
    "value",
    "currency",
    "contentName",
  ] as const) {
    if (typeof input[key] !== "string")
      return ["Campos da conversão inválidos."];
  }
  if (
    input.contentName.length > 2000 ||
    input.value.length > 100 ||
    input.currency.length > 3
  )
    return ["Campos da conversão excedem o tamanho permitido."];
  if (!Number.isFinite(new Date(input.eventTimeIso).getTime()))
    return ["Data da conversão inválida."];
  const key = input.idempotencyKey || input.saleKey;
  if (key && (typeof key !== "string" || !/^[a-zA-Z0-9_-]{12,128}$/.test(key)))
    return [
      "Identificador da venda inválido. Atualize a página e confira novamente.",
    ];
  return [];
}

async function prepare(input: EventFormInput, eventId: string) {
  const lead = await getLead(input.leadId);
  if (!lead) return null;
  const client = await getClient(lead.client_id);
  if (!client) return null;
  const extraErrors: string[] = [];
  const raw =
    lead.raw && typeof lead.raw === "object"
      ? (lead.raw as Record<string, unknown>)
      : {};
  const snapshot =
    raw._tracking_snapshot && typeof raw._tracking_snapshot === "object"
      ? (raw._tracking_snapshot as Record<string, unknown>)
      : {};
  if (
    (lead.ctwa_clid || lead.source_id) &&
    typeof snapshot.observed_at === "string" &&
    Math.floor(Date.parse(snapshot.observed_at) / 1000) >
      Math.floor(Date.parse(input.eventTimeIso) / 1000)
  ) {
    extraErrors.push(
      "A origem atual foi recebida após o horário desta conversão. Confira a data e o histórico do contato; esse clique não pode ser usado para uma venda anterior.",
    );
  }
  if (!MESSAGING_EVENTS.some((e) => e.value === input.eventName))
    extraErrors.push("Evento desconhecido.");
  if (!client.pixel_id)
    extraErrors.push("Cadastre o ID do pixel (dataset) neste cliente.");
  if (!client.capi_token_enc)
    extraErrors.push("Cadastre o token da API de Conversões neste cliente.");
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
    allowFallbackWithoutPageId: false,
  });
  const alreadySent = await countSent(lead.id, String(built.event.event_name));
  return {
    lead,
    client,
    built,
    value,
    errors: [...extraErrors, ...built.errors],
    alreadySent,
  };
}

export async function previewEventAction(
  input: EventFormInput,
): Promise<EventPreview> {
  await requireAuth();
  const invalid = eventInputErrors(input);
  if (invalid.length)
    return failedEvent("Confira os dados da conversão.", invalid);
  const p = await prepare(input, "(gerado no envio)");
  if (!p) return failedEvent("Lead não encontrado.");
  return {
    ok: p.errors.length === 0,
    errors: p.errors,
    warnings: p.built.warnings,
    payload: p.built.event,
    isTest: !!p.client.test_event_code,
    alreadySent: p.alreadySent,
    currency: input.currency || p.client.default_currency,
  };
}

function conversionFingerprint(input: EventFormInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        leadId: input.leadId,
        eventName: input.eventName,
        time: new Date(input.eventTimeIso).toISOString(),
        value: input.value.trim() ? parseMoney(input.value) : null,
        currency: input.currency.trim().toUpperCase(),
        content: input.contentName.trim(),
      }),
    )
    .digest("hex");
}

function conversionContext(ev: EventRow): Record<string, unknown> {
  const response =
    ev.response && typeof ev.response === "object"
      ? (ev.response as Record<string, unknown>)
      : {};
  return response.request_context &&
    typeof response.request_context === "object"
    ? (response.request_context as Record<string, unknown>)
    : {};
}

function revalidateConversion(leadId: string): void {
  for (const path of [
    `/leads/${leadId}`,
    "/eventos",
    "/conversas",
    "/dashboard",
    "/",
  ])
    revalidatePath(path);
}

function storedEventResult(ev: EventRow, message?: string): EventSendResult {
  const body =
    ev.payload && typeof ev.payload === "object"
      ? (ev.payload as Record<string, unknown>)
      : {};
  const data = Array.isArray(body.data)
    ? (body.data[0] as Record<string, unknown>)
    : null;
  return {
    ok: ev.status === "enviado",
    sent: ev.status === "enviado",
    errors: [],
    warnings: [],
    payload: data,
    isTest: ev.is_test,
    alreadySent: ev.status === "enviado" && !ev.is_test ? 1 : 0,
    currency: ev.currency || undefined,
    message:
      message ||
      (ev.status === "enviado"
        ? ev.is_test
          ? "Evento de teste já recebido pelo Meta. Nenhum novo envio foi criado."
          : "Esta conversão já foi recebida pelo Meta. Nenhum novo envio foi criado."
        : ev.error_message ||
          "Há um envio em andamento. Acompanhe o histórico antes de iniciar outra venda."),
  };
}

async function dispatchStoredEvent(ev: EventRow): Promise<EventSendResult> {
  let context = conversionContext(ev);
  const body =
    ev.payload && typeof ev.payload === "object"
      ? (ev.payload as Record<string, unknown>)
      : {};
  const event =
    Array.isArray(body.data) && body.data[0] && typeof body.data[0] === "object"
      ? (body.data[0] as Record<string, unknown>)
      : null;
  if (
    !event ||
    typeof context.pixel_id !== "string" ||
    typeof context.api_version !== "string"
  ) {
    return failedEvent(
      "Este registro antigo não tem destino e payload completos. Confira os dados antes de criar uma nova conversão.",
    );
  }
  if (!ev.is_test && ev.event_name === "Purchase") {
    // Reserve only after the event exists. The first intention stays immutable:
    // a failed insert cannot leave a pointer to a nonexistent sale, and a retry
    // from the history must obey the same authorization as the original send.
    const winner = await getOrCreateSetting(
      `conversion-guard:${ev.client_id}:${ev.lead_id}:Purchase`,
      ev.event_id,
    );
    if (winner !== ev.event_id) {
      const previous = await getEventByExternalId(ev.client_id, winner);
      const inProgress =
        !previous ||
        ["pendente", "enviando", "incerto"].includes(previous.status);
      if (inProgress || context.confirmed_new_sale !== true) {
        const message = inProgress
          ? "Existe uma intenção de compra pendente ou incerta. Acompanhe ou reenvie o registro anterior antes de iniciar outra compra."
          : "Esta intenção não foi autorizada como nova venda. Confira e confirme uma nova conversão pelo formulário; reenviar este registro não cria essa autorização.";
        await updateEvent(ev.id, { status: "erro", error_message: message });
        revalidateConversion(ev.lead_id);
        return {
          ...storedEventResult(ev),
          ok: false,
          sent: false,
          errors: [message],
          message,
        };
      }
    }
  }
  const client = await getClient(ev.client_id);
  if (!client?.capi_token_enc)
    return failedEvent("Cadastre o token da API de Conversões no cliente.");
  let token: string;
  try {
    token = decrypt(client.capi_token_enc, await appSecret());
  } catch (error) {
    return failedEvent(
      error instanceof Error ? error.message : "Não foi possível ler o token.",
    );
  }
  if (!(await claimEvent(ev.id))) {
    return storedEventResult((await getEvent(ev.id)) || ev);
  }
  const claimed = await getEvent(ev.id);
  if (claimed) context = conversionContext(claimed);
  const result = await sendEvent({
    apiVersion: String(context.api_version),
    pixelId: String(context.pixel_id),
    accessToken: token,
    event,
    testEventCode:
      typeof body.test_event_code === "string" ? body.test_event_code : null,
    // Reenvio é o mesmo evento aprovado; não altera corpo/nome/identidade silenciosamente.
    autoFallback: false,
  });
  try {
    await updateEvent(ev.id, {
      status: result.ok
        ? "enviado"
        : result.httpStatus === 0
          ? "incerto"
          : "erro",
      http_status: result.httpStatus,
      events_received: result.eventsReceived,
      fbtrace_id: result.fbtraceId,
      error_message: result.errorMessage,
      response: { request_context: context, meta_response: result.response },
    });
  } catch {
    revalidateConversion(ev.lead_id);
    return {
      ...storedEventResult(ev),
      ok: false,
      sent: false,
      message:
        "O Meta foi contatado, mas não foi possível gravar a resposta. O evento e seu ID estão preservados no histórico. Não crie outra venda; use Reenviar neste registro.",
    };
  }
  revalidateConversion(ev.lead_id);
  return {
    ok: result.ok,
    sent: result.ok,
    errors: result.ok ? [] : [result.errorMessage || "Envio não confirmado."],
    warnings: [],
    payload: event,
    isTest: ev.is_test,
    alreadySent: result.ok && !ev.is_test ? 1 : 0,
    currency: ev.currency || undefined,
    message: result.ok
      ? ev.is_test
        ? "Evento de teste recebido pelo Meta; não conta como venda em produção."
        : "Evento recebido pelo Meta. A atribuição ao anúncio depende da correspondência realizada pela plataforma."
      : result.errorMessage ||
        "O Meta não confirmou o recebimento. Reenvie o mesmo registro pelo histórico.",
  };
}

async function sendAndRecord(
  input: EventFormInput,
  eventId: string,
): Promise<EventSendResult> {
  const invalid = eventInputErrors(input);
  if (invalid.length)
    return failedEvent("Confira os dados da conversão.", invalid);
  const p = await prepare(input, eventId);
  if (!p) return failedEvent("Lead não encontrado.");
  const base: EventPreview = {
    ok: p.errors.length === 0,
    errors: p.errors,
    warnings: p.built.warnings,
    payload: p.built.event,
    isTest: !!p.client.test_event_code,
    alreadySent: p.alreadySent,
    currency: input.currency || p.client.default_currency,
  };
  if (p.errors.length)
    return {
      ...base,
      ok: false,
      sent: false,
      message: "Corrija os problemas antes de enviar.",
    };
  const fingerprint = conversionFingerprint(input);
  const existing = await getEventByExternalId(p.client.id, eventId);
  if (existing) {
    if (
      existing.lead_id !== p.lead.id ||
      conversionContext(existing).input_fingerprint !== fingerprint
    ) {
      return {
        ...base,
        ok: false,
        sent: false,
        errors: ["A intenção de venda já possui outros dados."],
        message: "Confira novamente antes de iniciar uma conversão diferente.",
      };
    }
    if (existing.status === "enviado" || existing.status === "enviando")
      return storedEventResult(existing);
    return dispatchStoredEvent(existing);
  }
  if (!base.isTest && p.alreadySent > 0 && input.confirmNewSale !== true) {
    return {
      ...base,
      ok: false,
      sent: false,
      errors: ["Este evento já foi enviado para o contato."],
      message:
        "Confirme explicitamente que se trata de uma nova venda antes de enviar outra conversão.",
    };
  }
  const custom = p.built.event.custom_data as
    Record<string, unknown> | undefined;
  const payload: Record<string, unknown> = {
    data: [p.built.event],
    partner_agent: "track-manual",
  };
  if (p.client.test_event_code)
    payload.test_event_code = p.client.test_event_code;
  let recordId: string;
  try {
    recordId = await insertEvent({
      client_id: p.client.id,
      lead_id: p.lead.id,
      event_name: String(p.built.event.event_name),
      event_id: eventId,
      event_time: new Date(input.eventTimeIso).toISOString(),
      value: p.value,
      currency: typeof custom?.currency === "string" ? custom.currency : null,
      content_name: input.contentName.trim() || null,
      action_source: p.built.actionSource,
      is_test: base.isTest,
      status: "pendente",
      http_status: null,
      events_received: null,
      fbtrace_id: null,
      error_message: null,
      payload,
      response: {
        request_context: {
          pixel_id: p.client.pixel_id,
          api_version: metaApiVersion(),
          input_fingerprint: fingerprint,
          confirmed_new_sale: input.confirmNewSale === true,
        },
      },
    });
  } catch {
    return {
      ...base,
      ok: false,
      sent: false,
      message:
        "Não foi possível preparar o evento no banco. Nada foi enviado ao Meta. Tente novamente sem alterar a intenção de venda.",
    };
  }
  const record = await getEvent(recordId);
  if (!record)
    return {
      ...base,
      ok: false,
      sent: false,
      message: "O evento não pôde ser recuperado. Nenhum envio foi iniciado.",
    };
  if (
    record.lead_id !== p.lead.id ||
    conversionContext(record).input_fingerprint !== fingerprint
  ) {
    return {
      ...base,
      ok: false,
      sent: false,
      errors: ["A intenção de venda já possui outros dados."],
      message: "Confira novamente antes de iniciar uma conversão diferente.",
    };
  }
  return dispatchStoredEvent(record);
}

export async function sendEventAction(
  input: EventFormInput,
): Promise<EventSendResult> {
  await requireAuth();
  return sendAndRecord(
    input,
    input?.idempotencyKey || input?.saleKey || randomUUID(),
  );
}

/** Reenvio conserva ID, destino, modo de teste e corpo da intenção original. */
export async function resendEventAction(fd: FormData): Promise<void> {
  await requireAuth();
  const id = text(fd, "event_id");
  if (!id) return;
  const ev = await getEvent(id);
  if (!ev || ev.status === "enviado") return;
  if (ev.status === "enviando") {
    // The lease belongs to this dispatch, never to the original creation date.
    // Old rows without a lease require review instead of risking parallel sends.
    const started = conversionContext(ev).dispatch_started_at;
    if (
      typeof started !== "string" ||
      !Number.isFinite(Date.parse(started)) ||
      Date.now() - Date.parse(started) < 120_000
    )
      return;
    // claimEvent atomically takes over an expired lease; never reset it here.
  }
  await dispatchStoredEvent(ev);
}

// ---------------------------------------------------------------------------
// Dados do anúncio
// ---------------------------------------------------------------------------

export async function refreshAdAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireAuth();
  const leadId = text(fd, "lead_id");
  if (!leadId) return { error: "Lead não informado." };
  const lead = await getLead(leadId);
  const client = lead ? await getClient(lead.client_id) : null;
  if (!lead || !client) return { error: "Lead não encontrado." };
  if (!lead.source_id)
    return { error: "Este lead não tem ID de origem (ID do anúncio)." };

  const tokenEnc = client.marketing_token_enc || client.capi_token_enc;
  if (!tokenEnc) {
    return {
      error:
        "Cadastre no cliente o Token da API de Conversões ou o Token de Leitura.",
    };
  }

  let token: string;
  try {
    token = decrypt(tokenEnc, await appSecret());
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  const res = await fetchAd({
    apiVersion: metaApiVersion(),
    adId: lead.source_id,
    accessToken: token,
  });
  if (!res.ok) return { error: res.error };

  await upsertAd({ client_id: client.id, ad_id: lead.source_id, ...res.ad });
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/");
  return { error: null };
}

/**
 * Sincroniza dados e gastos de todos os anúncios associados a leads no Meta,
 * atualizando o cache para o Dashboard de ROI/ROAS em tempo real.
 */
interface CampaignSyncOptions {
  campaignStatus?: "active" | "paused" | "all";
  campaignIds?: string[];
}

async function saveCampaignCatalog(
  clientId: string,
  result: {
    accountId: string;
    campaigns: { id: string }[];
    partial: boolean;
    warnings: string[];
  },
  replace: boolean,
) {
  const key = `meta_campaign_catalog_${clientId}`;
  let previous: { accountId?: string; campaigns?: { id: string }[] } = {};
  try {
    const parsed = JSON.parse((await getSetting(key)) || "{}");
    if (parsed && typeof parsed === "object") previous = parsed;
  } catch {
    /* first valid snapshot replaces malformed legacy data */
  }
  const campaigns = new Map(
    ((!replace || result.partial) &&
    previous.accountId === result.accountId &&
    Array.isArray(previous.campaigns)
      ? previous.campaigns
      : []
    ).map((campaign) => [campaign.id, campaign]),
  );
  for (const campaign of result.campaigns) campaigns.set(campaign.id, campaign);
  await setSettings({
    [key]: JSON.stringify({
      accountId: result.accountId,
      campaigns: [...campaigns.values()],
      syncedAt: new Date().toISOString(),
      partial: result.partial,
      warnings: result.warnings,
    }),
  });
}

/** Refresh only the campaign catalogue; no conversion or message is sent. */
export async function loadDashboardCampaignsAction(
  clientId?: string | null,
): Promise<{ ok: boolean; campaignsLoaded: number; message: string }> {
  await requireAuth();
  const clients = (await listClients()).filter(
    (client) => !clientId || client.id === clientId,
  );
  const errors: string[] = [];
  let loaded = 0,
    succeeded = 0;
  for (const client of clients) {
    const encrypted = client.marketing_token_enc || client.capi_token_enc;
    if (!encrypted) {
      errors.push(`${client.name}: cadastre um token com permissão ads_read.`);
      continue;
    }
    try {
      const result = await fetchAdAccountCampaigns({
        apiVersion: metaApiVersion(),
        adAccountId: client.ad_account_id,
        accessToken: decrypt(encrypted, await appSecret()),
        campaignStatus: "all",
      });
      if (!result.ok) {
        errors.push(`${client.name}: ${result.error}`);
        continue;
      }
      await saveCampaignCatalog(client.id, result, true);
      if (!client.ad_account_id)
        await updateClient(client.id, { ad_account_id: result.accountId });
      loaded += result.campaigns.length;
      succeeded++;
      errors.push(
        ...result.warnings.map((warning) => `${client.name}: ${warning}`),
      );
    } catch {
      errors.push(
        `${client.name}: não foi possível carregar as campanhas. Confira a conta e o token.`,
      );
    }
  }
  revalidatePath("/dashboard");
  return {
    ok: succeeded > 0 && errors.length === 0,
    campaignsLoaded: loaded,
    message: `${loaded} campanha(s) carregada(s) para seleção. ${errors.join(" ") || (succeeded ? "Selecione o status e as campanhas que deseja sincronizar." : "Cadastre e configure uma empresa primeiro.")}`,
  };
}

export async function syncDashboardMetaAction(
  clientId?: string | null,
  options: CampaignSyncOptions = {},
): Promise<{ ok: boolean; syncedCount: number; message: string }> {
  await requireAuth();
  const status = options?.campaignStatus || "active";
  const ids = options?.campaignIds || [];
  if (
    !["active", "paused", "all"].includes(status) ||
    !Array.isArray(ids) ||
    ids.length > 200 ||
    ids.some((id) => typeof id !== "string" || !/^\d{1,30}$/.test(id))
  ) {
    return {
      ok: false,
      syncedCount: 0,
      message:
        "Seleção de campanhas inválida. Atualize os filtros e tente novamente.",
    };
  }
  if (ids.length && !clientId)
    return {
      ok: false,
      syncedCount: 0,
      message:
        "Selecione uma empresa antes de escolher campanhas específicas da conta de anúncios.",
    };
  const clients = (await listClients()).filter(
    (client) => !clientId || client.id === clientId,
  );
  if (!clients.length)
    return { ok: false, syncedCount: 0, message: "Nenhum cliente cadastrado." };
  let synced = 0,
    succeeded = 0;
  const errors: string[] = [];
  for (const client of clients) {
    const encrypted = client.marketing_token_enc || client.capi_token_enc;
    if (!encrypted) {
      errors.push(`${client.name}: cadastre um token com permissão ads_read.`);
      continue;
    }
    try {
      const result = await fetchAdAccountAdsAndInsights({
        apiVersion: metaApiVersion(),
        adAccountId: client.ad_account_id,
        accessToken: decrypt(encrypted, await appSecret()),
        campaignStatus: status,
        campaignIds: [...new Set(ids)],
      });
      if (!result.ok) {
        errors.push(`${client.name}: ${result.error}`);
        continue;
      }
      const synchronizedIds: string[] = [];
      for (const ad of result.ads) {
        const adId = (ad.raw as { item?: { id?: unknown } })?.item?.id;
        if (typeof adId !== "string" || !/^\d{1,30}$/.test(adId)) continue;
        await upsertAd({ client_id: client.id, ad_id: adId, ...ad });
        synced++;
        synchronizedIds.push(adId);
      }
      let previousIndex: { accountId?: string; adIds?: string[] } = {};
      try {
        const parsed = JSON.parse(
          (await getSetting(`meta_synced_ad_ids_${client.id}`)) || "{}",
        );
        if (parsed && typeof parsed === "object") previousIndex = parsed;
      } catch {}
      const existingIds =
        previousIndex.accountId === result.accountId &&
        Array.isArray(previousIndex.adIds)
          ? previousIndex.adIds.filter(
              (id) => typeof id === "string" && /^\d{1,30}$/.test(id),
            )
          : [];
      await setSettings({
        [`meta_synced_ad_ids_${client.id}`]: JSON.stringify({
          accountId: result.accountId,
          adIds: [...new Set([...existingIds, ...synchronizedIds])],
          syncedAt: new Date().toISOString(),
        }),
      });
      await saveCampaignCatalog(
        client.id,
        result,
        status === "all" && ids.length === 0,
      );
      if (!client.ad_account_id)
        await updateClient(client.id, { ad_account_id: result.accountId });
      succeeded++;
      errors.push(
        ...result.warnings.map((warning) => `${client.name}: ${warning}`),
      );
    } catch {
      errors.push(
        `${client.name}: a sincronização foi interrompida. Confira a conta e o token.`,
      );
    }
  }
  revalidatePath("/dashboard");
  revalidatePath("/");
  const label =
    status === "active"
      ? "ativas"
      : status === "paused"
        ? "pausadas"
        : "de todos os status";
  return {
    ok: succeeded > 0 && errors.length === 0,
    syncedCount: synced,
    message: `${synced} anúncio(s) sincronizado(s) de campanhas ${label}${ids.length ? " dentro da seleção" : ""}. ${errors.join(" ") || "O status do anúncio pode diferir do status da campanha."}`,
  };
}

// ---------------------------------------------------------------------------
// Conexão WhatsApp via Evolution API (QR Code)
// ---------------------------------------------------------------------------

export async function getEvolutionStatusAction(opts: {
  serverUrl: string;
  apiKey: string;
  instanceName: string;
}): Promise<{
  ok: boolean;
  state: string;
  phone?: string | null;
  error?: string;
}> {
  await requireAuth();
  return evolutionGetState(opts);
}

export async function connectEvolutionAction(opts: {
  serverUrl: string;
  apiKey: string;
  instanceName: string;
  clientId: string;
}): Promise<{
  ok: boolean;
  state: "open" | "connecting" | "close";
  qrcode: string | null;
  phone?: string | null;
  error?: string;
}> {
  await requireAuth();
  const client = await getClient(opts.clientId);
  if (!client)
    return {
      ok: false,
      state: "close",
      qrcode: null,
      error: "Cliente não encontrado.",
    };

  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  const proto = h.get("x-forwarded-proto") || "http";
  const webhookUrl = `${proto}://${host}/api/webhook/evolution/${client.webhook_key}`;

  return evolutionCreateOrConnect(
    {
      serverUrl: opts.serverUrl,
      apiKey: opts.apiKey,
      instanceName: opts.instanceName,
    },
    webhookUrl,
  );
}

export async function disconnectEvolutionAction(opts: {
  serverUrl: string;
  apiKey: string;
  instanceName: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireAuth();
  return evolutionLogout(opts);
}

// ---------------------------------------------------------------------------
// Conexão WhatsApp via WAHA (WhatsApp HTTP API - Docker / VPS)
// ---------------------------------------------------------------------------

export async function getWahaStatusAction(opts: {
  serverUrl: string;
  apiKey?: string;
  sessionName: string;
}): Promise<{
  ok: boolean;
  state: string;
  phone?: string | null;
  qrcode?: string | null;
  error?: string;
}> {
  await requireAuth();
  const state = await wahaGetState(opts);
  let qrcode: string | null = null;
  if (state.ok && state.state === "connecting") {
    qrcode = await wahaGetQrCode(opts);
  }
  return { ...state, qrcode };
}

export async function connectWahaAction(opts: {
  serverUrl: string;
  apiKey?: string;
  sessionName: string;
  clientId: string;
}): Promise<{
  ok: boolean;
  state: "open" | "connecting" | "close";
  qrcode: string | null;
  phone?: string | null;
  error?: string;
}> {
  await requireAuth();
  const client = await getClient(opts.clientId);
  if (!client)
    return {
      ok: false,
      state: "close",
      qrcode: null,
      error: "Cliente não encontrado.",
    };

  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  const proto = h.get("x-forwarded-proto") || "http";
  const webhookUrl = `${proto}://${host}/api/webhook/waha/${client.webhook_key}`;

  return wahaCreateOrConnect(
    {
      serverUrl: opts.serverUrl,
      apiKey: opts.apiKey,
      sessionName: opts.sessionName,
    },
    webhookUrl,
  );
}

export async function disconnectWahaAction(opts: {
  serverUrl: string;
  apiKey?: string;
  sessionName: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireAuth();
  return wahaLogout(opts);
}

// ---------------------------------------------------------------------------
// Conexão WhatsApp Nativa / Direta (Baileys Integrado no Track Manual)
// ---------------------------------------------------------------------------

export async function getNativeWhatsAppStatusAction(clientId: string): Promise<{
  ok: boolean;
  state: "open" | "connecting" | "close";
  qrcode: string | null;
  phone: string | null;
  name: string | null;
}> {
  await requireAuth();
  const { getNativeWhatsAppStatus } = await import("@/lib/whatsapp-baileys");
  return await getNativeWhatsAppStatus(clientId);
}

export async function connectNativeWhatsAppAction(clientId: string): Promise<{
  ok: boolean;
  state: "open" | "connecting" | "close";
  qrcode: string | null;
  phone?: string | null;
  error?: string;
}> {
  await requireAuth();
  const client = await getClient(clientId);
  if (!client)
    return {
      ok: false,
      state: "close",
      qrcode: null,
      error: "Cliente não encontrado.",
    };

  const { connectNativeWhatsApp } = await import("@/lib/whatsapp-baileys");
  return connectNativeWhatsApp(clientId);
}

export async function disconnectNativeWhatsAppAction(
  clientId: string,
): Promise<{
  ok: boolean;
  error?: string;
}> {
  await requireAuth();
  const { disconnectNativeWhatsApp } = await import("@/lib/whatsapp-baileys");
  return disconnectNativeWhatsApp(clientId);
}

export async function sendWhatsAppMessageAction(
  clientId: string,
  phone: string,
  text: string,
): Promise<{ ok: boolean; error?: string; warning?: string }> {
  await requireAuth();
  if (!(await getClient(clientId)))
    return { ok: false, error: "Cliente não encontrado." };
  const number = normalizePhone(phone);
  if (
    !number ||
    typeof text !== "string" ||
    !text.trim() ||
    text.length > 20000
  )
    return {
      ok: false,
      error:
        "Informe um telefone e uma mensagem válidos (até 20.000 caracteres).",
    };
  const { channelConfiguration } = await import("@/lib/channels");
  const configuration = await channelConfiguration(clientId);
  if (configuration.provider === "native") {
    const { sendNativeWhatsAppMessage } =
      await import("@/lib/whatsapp-baileys");
    const result = await sendNativeWhatsAppMessage(
      clientId,
      number,
      text.trim(),
    );
    revalidatePath("/conversas");
    return result;
  }
  const result =
    configuration.provider === "waha"
      ? await (
          await import("@/lib/waha")
        ).wahaSendMessage(
          {
            serverUrl: configuration.serverUrl,
            apiKey: configuration.apiKey || undefined,
            sessionName: configuration.sessionName,
          },
          number,
          text.trim(),
        )
      : await (
          await import("@/lib/evolution")
        ).evolutionSendMessage(
          {
            serverUrl: configuration.serverUrl,
            apiKey: configuration.apiKey,
            instanceName: configuration.sessionName,
          },
          number,
          text.trim(),
        );
  if (!result.ok) return result;
  try {
    await (
      await import("@/lib/ingest")
    ).ingestLead(clientId, { phone: number }, "manual", {
      provider: configuration.provider,
      message_id: result.messageId || randomUUID(),
      received_at: new Date().toISOString(),
      message_text: text.trim(),
      fromMe: true,
      type: "text",
    });
  } catch {
    return {
      ok: true,
      warning:
        "Mensagem enviada, mas o histórico não foi atualizado. Não reenvie para evitar duplicidade.",
    };
  }
  revalidatePath("/conversas");
  return { ok: true };
}

export async function sendWhatsAppMediaAction(
  clientId: string,
  phone: string,
  media: {
    base64: string;
    mimetype: string;
    filename?: string;
    caption?: string;
  },
): Promise<{ ok: boolean; error?: string; warning?: string }> {
  await requireAuth();
  if (!(await getClient(clientId)))
    return { ok: false, error: "Cliente não encontrado." };
  const number = normalizePhone(phone);
  if (
    !number ||
    !media ||
    typeof media.base64 !== "string" ||
    typeof media.mimetype !== "string"
  )
    return { ok: false, error: "Arquivo ou telefone inválido." };
  const base64 = media.base64.replace(/^data:[^,]+;base64,/, "");
  const mimeAllowed =
    /^(image\/(jpeg|png|webp|gif)|audio\/[a-z0-9.+-]+|video\/(mp4|webm|quicktime)|text\/(plain|csv)|application\/(pdf|octet-stream|msword|vnd\.[a-z0-9.+-]+))$/i.test(
      media.mimetype,
    );
  if (
    !mimeAllowed ||
    !base64 ||
    base64.length > 7_000_000 ||
    Buffer.byteLength(base64, "base64") > 5 * 1024 * 1024
  )
    return {
      ok: false,
      error: "Envie uma imagem, áudio, vídeo ou documento de até 5 MB.",
    };
  const safeMedia = {
    ...media,
    base64,
    mimetype: media.mimetype,
    filename: media.filename?.replace(/[\\/\x00-\x1f]/g, "_").slice(0, 150),
    caption: media.caption?.slice(0, 20000),
  };
  const { channelConfiguration } = await import("@/lib/channels");
  const configuration = await channelConfiguration(clientId);
  if (configuration.provider === "native") {
    const result = await (
      await import("@/lib/whatsapp-baileys")
    ).sendNativeWhatsAppMedia(clientId, number, safeMedia);
    revalidatePath("/conversas");
    return result;
  }
  const result =
    configuration.provider === "waha"
      ? await (
          await import("@/lib/waha")
        ).wahaSendMedia(
          {
            serverUrl: configuration.serverUrl,
            apiKey: configuration.apiKey || undefined,
            sessionName: configuration.sessionName,
          },
          number,
          safeMedia,
        )
      : await (
          await import("@/lib/evolution")
        ).evolutionSendMedia(
          {
            serverUrl: configuration.serverUrl,
            apiKey: configuration.apiKey,
            instanceName: configuration.sessionName,
          },
          number,
          safeMedia,
        );
  if (!result.ok) return result;
  const type = media.mimetype.startsWith("image/")
    ? "image"
    : media.mimetype.startsWith("audio/")
      ? "audio"
      : media.mimetype.startsWith("video/")
        ? "video"
        : "document";
  try {
    await (
      await import("@/lib/ingest")
    ).ingestLead(clientId, { phone: number }, "manual", {
      provider: configuration.provider,
      message_id: result.messageId || randomUUID(),
      received_at: new Date().toISOString(),
      message_text: media.caption || media.filename || "Anexo enviado",
      fromMe: true,
      type,
      mimetype: media.mimetype,
      base64,
      filename: safeMedia.filename,
    });
  } catch {
    return {
      ok: true,
      warning:
        "Arquivo enviado, mas o histórico não foi atualizado. Não reenvie para evitar duplicidade.",
    };
  }
  revalidatePath("/conversas");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Importação de proposta via arquivo .TXT com Auto-Disparo de Compra
// ---------------------------------------------------------------------------

export async function importFromTxtAction(
  clientId: string,
  text: string,
  _autoPurchase: boolean = false,
): Promise<{
  ok: boolean;
  leadId?: string;
  name?: string | null;
  phone?: string | null;
  purchaseSent?: boolean;
  value?: number | null;
  error?: string;
}> {
  await requireAuth();
  if (!clientId) return { ok: false, error: "Cliente não selecionado." };

  const { parseTxtProposal } = await import("@/lib/parse-txt");
  const { ingestLead } = await import("@/lib/ingest");

  const parsed = parseTxtProposal(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { name, phone, city, state, zip, notes, value } = parsed.fields;
  if (!phone)
    return { ok: false, error: "Telefone não encontrado no arquivo." };

  const result = await ingestLead(
    clientId,
    { name, phone, city, state, zip, notes },
    "manual",
  );

  if (!result.ok) return { ok: false, error: result.error };

  // Importar uma proposta nunca confirma que houve pagamento. A venda é conferida no contato.
  const purchaseSent = false;

  revalidatePath("/");
  revalidatePath("/leads");
  revalidatePath("/eventos");
  revalidatePath("/dashboard");

  return { ok: true, leadId: result.leadId, name, phone, purchaseSent, value };
}

// ---------------------------------------------------------------------------
// Teste de Conexão com o Meta (Pixel, CAPI, Token de Leitura)
// ---------------------------------------------------------------------------

export async function testMetaConnectionAction(clientId: string): Promise<{
  ok: boolean;
  checks: {
    pixel: { ok: boolean; message: string };
    capi: { ok: boolean; message: string };
    marketing: { ok: boolean; message: string };
  };
}> {
  await requireAuth();
  const client = await getClient(clientId);
  if (!client) {
    return {
      ok: false,
      checks: {
        pixel: { ok: false, message: "Cliente não encontrado." },
        capi: { ok: false, message: "Cliente não encontrado." },
        marketing: { ok: false, message: "Cliente não encontrado." },
      },
    };
  }

  const secret = await appSecret();
  const capiToken = client.capi_token_enc
    ? decrypt(client.capi_token_enc, secret)
    : null;
  const mktToken = client.marketing_token_enc
    ? decrypt(client.marketing_token_enc, secret)
    : null;

  let capiOk = false;
  let capiMsg = "";

  if (!client.pixel_id) {
    capiMsg = "ID do Pixel/Dataset não preenchido.";
  } else if (!capiToken) {
    capiMsg = "Token da API de Conversões não preenchido.";
  } else {
    try {
      const testRes = await sendEvent({
        apiVersion: metaApiVersion(),
        pixelId: client.pixel_id,
        accessToken: capiToken,
        testEventCode: client.test_event_code || "TEST_PING",
        event: {
          event_name: "TestPing",
          event_time: Math.floor(Date.now() / 1000),
          event_id: `ping-${Date.now()}`,
          action_source: "chat",
          user_data: {
            ph: [
              "0000000000000000000000000000000000000000000000000000000000000000",
            ],
          },
        },
      });
      if (testRes.ok) {
        capiOk = true;
        capiMsg = `Conectado com sucesso! Pixel/Dataset ${client.pixel_id} recebeu o evento de teste.`;
      } else {
        capiMsg =
          testRes.errorMessage || "Meta respondeu com erro ao testar envio.";
      }
    } catch (e) {
      capiMsg = e instanceof Error ? e.message : String(e);
    }
  }

  let mktOk = false;
  let mktMsg = "";
  const tokenForRead = mktToken || capiToken;

  if (!tokenForRead) {
    mktMsg = "Nenhum token disponível para teste.";
  } else {
    try {
      const meRes = await fetch(
        `https://graph.facebook.com/${metaApiVersion()}/me?fields=id,name&access_token=${encodeURIComponent(tokenForRead)}`,
      );
      const meJson = (await meRes.json()) as {
        id?: string;
        name?: string;
        error?: { message?: string };
      };
      if (meRes.ok && meJson.id) {
        mktOk = true;
        mktMsg = `Token autenticado com sucesso como "${meJson.name || meJson.id}".`;
      } else {
        mktMsg = meJson.error?.message || "Token inválido ou expirado.";
      }
    } catch (e) {
      mktMsg = e instanceof Error ? e.message : String(e);
    }
  }

  return {
    ok: capiOk && mktOk,
    checks: {
      pixel: {
        ok: Boolean(client.pixel_id),
        message: client.pixel_id
          ? `Pixel/Dataset ID: ${client.pixel_id}`
          : "Não preenchido",
      },
      capi: { ok: capiOk, message: capiMsg },
      marketing: { ok: mktOk, message: mktMsg },
    },
  };
}

// ---------------------------------------------------------------------------
// Ajuste Manual de Gasto de Anúncio / Campanha
// ---------------------------------------------------------------------------

export async function setAdSpendAction(
  clientId: string,
  adId: string,
  spend: number,
): Promise<{ ok: boolean }> {
  await requireAuth();
  await upsertAd({
    client_id: clientId,
    ad_id: adId,
    spend,
  });
  revalidatePath("/dashboard");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Referências manuais e recuperação conservadora de CTWA
// ---------------------------------------------------------------------------

interface ReceivedReference {
  ctwa_clid: string | null;
  source_id: string | null;
  source_url: string | null;
  source_type: string | null;
  headline: string | null;
  ad_body: string | null;
  thumbnail_url: string | null;
  media_url: string | null;
  observed_at?: string;
}

function emptyReference(): ReceivedReference {
  return {
    ctwa_clid: null,
    source_id: null,
    source_url: null,
    source_type: null,
    headline: null,
    ad_body: null,
    thumbnail_url: null,
    media_url: null,
  };
}

function referenceText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function referenceDate(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  let input = typeof value === "number" ? value : String(value);
  if (typeof input === "string" && /^\d+$/.test(input)) input = Number(input);
  if (typeof input === "number" && input < 1e12) input *= 1000;
  const time = new Date(input);
  return Number.isFinite(time.getTime()) ? time.toISOString() : undefined;
}

/** Extract a single referral unit; never combine fields from unrelated messages. */
async function receivedReferences(data: unknown): Promise<ReceivedReference[]> {
  const { normalizeCtwaClid, ctwaFromUrl } = await import("@/lib/ctwa");
  const refs: ReceivedReference[] = [];
  const seen = new WeakSet<object>();
  const scan = (value: unknown, depth: number, inheritedAt?: string) => {
    if (
      depth > 20 ||
      value == null ||
      Buffer.isBuffer(value) ||
      value instanceof Uint8Array
    )
      return;
    if (typeof value === "string") {
      const clid = ctwaFromUrl(value);
      if (!clid) return;
      let sourceId: string | null = null;
      try {
        const url = new URL(value);
        const id =
          url.searchParams.get("ad_id") ||
          url.searchParams.get("source_id") ||
          url.searchParams.get("hsa_ad");
        if (id && /^\d{6,}$/.test(id)) sourceId = id;
      } catch {}
      refs.push({
        ...emptyReference(),
        ctwa_clid: clid,
        source_id: sourceId,
        source_url: /^https?:\/\//.test(value) ? value : null,
        observed_at: inheritedAt,
      });
      return;
    }
    if (typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of [...value].reverse())
        scan(item, depth + 1, inheritedAt);
      return;
    }
    const obj = value as Record<string, unknown>;
    const key =
      obj.key && typeof obj.key === "object"
        ? (obj.key as Record<string, unknown>)
        : {};
    if (obj.fromMe === true || obj.from_me === true || key.fromMe === true)
      return;
    const at =
      referenceDate(
        obj.received_at ?? obj.at ?? obj.message_timestamp ?? obj.timestamp,
      ) || inheritedAt;
    // Arrays are oldest-first in the stored history. A newer incomplete referral
    // must not borrow a click ID from an older referral, even to the same ad.
    if (Array.isArray(obj.messages)) scan(obj.messages, depth + 1, at);
    const reply =
      obj.externalAdReply && typeof obj.externalAdReply === "object"
        ? (obj.externalAdReply as Record<string, unknown>)
        : {};
    const unit = { ...reply, ...obj };
    const sourceUrl = referenceText(
      unit.source_url ?? unit.sourceUrl ?? unit._baileys_source_url,
    );
    let sourceId = referenceText(
      unit.source_id ??
        unit.sourceId ??
        unit.ad_id ??
        unit.adId ??
        unit.hsa_ad ??
        unit._baileys_source_id,
    );
    if (sourceId && !/^\d{6,}$/.test(sourceId)) sourceId = null;
    if (!sourceId && sourceUrl) {
      try {
        const url = new URL(sourceUrl);
        const id =
          url.searchParams.get("ad_id") ||
          url.searchParams.get("source_id") ||
          url.searchParams.get("hsa_ad");
        if (id && /^\d{6,}$/.test(id)) sourceId = id;
      } catch {}
    }
    const clid =
      normalizeCtwaClid(
        obj.ctwa_clid ?? obj.ctwaClid ?? obj._baileys_ctwa_clid,
      ) ||
      normalizeCtwaClid(reply.ctwa_clid ?? reply.ctwaClid) ||
      ctwaFromUrl(sourceUrl);
    if (sourceId || clid) {
      refs.push({
        ...emptyReference(),
        ctwa_clid: clid,
        source_id: sourceId,
        source_url: sourceUrl,
        source_type: referenceText(unit.source_type ?? unit.sourceType),
        headline: referenceText(
          unit.headline ??
            unit.title ??
            unit.ad_title ??
            unit._baileys_headline,
        ),
        ad_body: referenceText(
          unit.ad_body ?? unit.adBody ?? unit.body ?? unit._baileys_ad_body,
        ),
        thumbnail_url: referenceText(
          unit.thumbnail_url ??
            unit.thumbnailUrl ??
            unit._baileys_thumbnail_url,
        ),
        media_url: referenceText(unit.media_url ?? unit.mediaUrl),
        observed_at: at,
      });
      return;
    }
    for (const [key, child] of Object.entries(obj)) {
      if (
        [
          "messages",
          "quotedMessage",
          "quotedMessageContext",
          "externalAdReply",
        ].includes(key)
      )
        continue;
      if (
        (child && typeof child === "object") ||
        ["source_url", "sourceUrl", "url"].includes(key)
      )
        scan(child, depth + 1, at);
    }
  };
  scan(data, 0);
  return refs;
}

async function saveReference(
  leadId: string,
  reference: ReceivedReference,
  origin: string,
): Promise<void> {
  const { withTrackingTouch } = await import("@/lib/lead-tracking");
  const { updateLeadWithRaw } = await import("@/lib/store");
  const { observed_at, ...fields } = reference;
  const now = new Date().toISOString();
  await updateLeadWithRaw(
    leadId,
    { ...fields, clid_seen_at: fields.ctwa_clid ? observed_at || now : null },
    withTrackingTouch(
      { provider: origin },
      fields,
      origin,
      observed_at || now,
      { forceNew: true },
    ),
  );
  revalidateConversion(leadId);
}

export async function assignLeadAdAction(
  leadId: string,
  adId: string,
): Promise<{ ok: boolean; message: string }> {
  return setLeadAdAction(leadId, adId);
}

export async function pullCtwaFromPhoneAction(
  leadId: string,
): Promise<{ ok: boolean; message: string; ctwa_clid?: string | null }> {
  await requireAuth();
  const lead = await getLead(leadId);
  if (!lead) return { ok: false, message: "Lead não encontrado." };
  const { normalizeCtwaClid } = await import("@/lib/ctwa");
  const existing = normalizeCtwaClid(lead.ctwa_clid);
  if (existing)
    return {
      ok: true,
      message:
        "CTWA Click ID já registrado. A atribuição ainda depende da validação e correspondência da Meta.",
      ctwa_clid: existing,
    };
  const raw =
    lead.raw && typeof lead.raw === "object" && !Array.isArray(lead.raw)
      ? (lead.raw as Record<string, unknown>)
      : {};
  if (raw._tracking_snapshot && typeof raw._tracking_snapshot === "object")
    return {
      ok: false,
      ctwa_clid: null,
      message:
        "A origem atual não contém CTWA Click ID. Um identificador de outra mensagem ou de outro clique não será reutilizado.",
    };
  // Only this contact's most recent received referral can recover its click ID.
  // A phone number (or an ad ID alone) cannot prove that two records share a click.
  let candidates = await receivedReferences(lead.raw);
  if (!candidates.length && lead.source_url)
    candidates = await receivedReferences(lead.source_url);
  if (!candidates.length && lead.notes)
    candidates = await receivedReferences(lead.notes);
  const latest = candidates[0];
  const matchesCurrent =
    latest && (!lead.source_id || latest.source_id === lead.source_id);
  if (latest?.ctwa_clid && matchesCurrent) {
    await saveReference(leadId, latest, "recovered");
    return {
      ok: true,
      ctwa_clid: latest.ctwa_clid,
      message:
        "CTWA recuperado com os dados do mesmo contexto recebido. Confira o envio e a atribuição na Meta.",
    };
  }
  if (latest?.source_id && !latest.ctwa_clid && !lead.source_id)
    await saveReference(leadId, latest, "recovered");
  return {
    ok: false,
    ctwa_clid: null,
    message:
      latest && !matchesCurrent
        ? "O identificador encontrado pertence a outra origem ou não possui anúncio pareado. Ele não foi associado ao anúncio atual."
        : "Nenhum CTWA Click ID do contexto atual foi encontrado. Conhecer o anúncio ou o telefone não permite reconstruir o clique.",
  };
}

export async function setLeadAdAction(
  leadId: string,
  adId: string,
): Promise<{ ok: boolean; message: string }> {
  await requireAuth();
  const lead = await getLead(leadId);
  if (!lead) return { ok: false, message: "Lead não encontrado." };
  const clean = typeof adId === "string" ? adId.trim() : "";
  if (!/^\d{6,}$/.test(clean))
    return {
      ok: false,
      message: "ID do Anúncio inválido (apenas números, mínimo 6 dígitos).",
    };
  const changed = lead.source_id !== clean;
  if (changed)
    await saveReference(
      leadId,
      { ...emptyReference(), source_id: clean },
      "manual",
    );
  void import("@/lib/ingest")
    .then(({ enrichAdInRealTime }) => enrichAdInRealTime(lead.client_id, clean))
    .catch(() => {});
  return {
    ok: true,
    message: changed
      ? `Anúncio #${clean} vinculado. A referência de clique anterior foi removida para não misturar origens. O ID do anúncio não substitui um CTWA Click ID.`
      : `Anúncio #${clean} já vinculado. A atribuição depende do CTWA e da correspondência realizada pela Meta.`,
  };
}

export async function setLeadCtwaAction(
  leadId: string,
  ctwaClid: string,
): Promise<{ ok: boolean; message: string }> {
  await requireAuth();
  const lead = await getLead(leadId);
  if (!lead) return { ok: false, message: "Lead não encontrado." };
  const { normalizeCtwaClid } = await import("@/lib/ctwa");
  const clean = normalizeCtwaClid(ctwaClid);
  if (!clean || clean.length < 10)
    return {
      ok: false,
      message:
        "CTWA Click ID inválido. Use apenas o identificador real recebido do provedor.",
    };
  if (lead.ctwa_clid !== clean)
    await saveReference(
      leadId,
      { ...emptyReference(), ctwa_clid: clean },
      "manual",
    );
  return {
    ok: true,
    message:
      "CTWA salvo. Uma referência de anúncio de outro contexto não será reutilizada; a Meta avalia a atribuição pelo identificador real.",
  };
}

// ---------------------------------------------------------------------------
// Configurações Avançadas e Auto-Limpeza de Mídias
// ---------------------------------------------------------------------------

export async function saveSystemSettingsAction(
  settings: Record<string, string>,
): Promise<{ ok: boolean; message: string }> {
  "use server";
  await requireAuth();
  const allowed = new Set([
    "sound_notifications",
    "tab_badge_notifications",
    "system_favicon_url",
    "media_retention_days",
  ]);
  if (
    !settings ||
    typeof settings !== "object" ||
    Object.keys(settings).some((key) => !allowed.has(key))
  )
    return { ok: false, message: "Configuração não permitida." };
  for (const [key, value] of Object.entries(settings)) {
    if (typeof value !== "string")
      return { ok: false, message: "Valor de configuração inválido." };
    if (
      (key === "sound_notifications" || key === "tab_badge_notifications") &&
      !["true", "false"].includes(value)
    )
      return { ok: false, message: "Preferência inválida." };
    if (
      key === "media_retention_days" &&
      !["7", "15", "30", "60", "90"].includes(value)
    )
      return { ok: false, message: "Escolha um prazo entre 7 e 90 dias." };
    if (
      key === "system_favicon_url" &&
      (value.length > 350000 ||
        !(
          value === "/favicon.svg" ||
          /^https:\/\//.test(value) ||
          /^data:image\/(png|jpeg|webp|x-icon|vnd.microsoft.icon);base64,[a-zA-Z0-9+/=]+$/.test(
            value,
          )
        ))
    )
      return {
        ok: false,
        message:
          "Use uma imagem PNG, JPEG, WebP ou ICO de até 256 KB, ou um endereço HTTPS.",
      };
  }
  const { setSettings } = await import("@/lib/store");
  await setSettings(settings);
  revalidatePath("/configuracoes");
  revalidatePath("/conversas");
  revalidatePath("/dashboard");
  return { ok: true, message: "Configurações do sistema salvas com sucesso!" };
}

export async function executeMediaCleanupAction(
  daysThreshold = 30,
): Promise<{ ok: boolean; message: string; cleanedCount: number }> {
  "use server";
  await requireAuth();
  const { listLeads } = await import("@/lib/store");

  if (![7, 15, 30, 60, 90].includes(daysThreshold))
    return {
      ok: false,
      cleanedCount: 0,
      message: "Prazo de limpeza inválido.",
    };
  const cutoff = Date.now() - daysThreshold * 86_400_000;
  let offset = 0;
  const { updateLeadWithRaw } = await import("@/lib/store");
  let cleanedCount = 0;

  while (true) {
    const leads = await listLeads({ limit: 250, offset });
    if (!leads.length) break;
    for (const lead of leads) {
      const raw = lead.raw as Record<string, any> | null;
      if (!raw || !Array.isArray(raw.messages)) continue;

      let modified = false;
      raw.messages.forEach((m: any) => {
        const msgTime = new Date(m.at || lead.first_seen_at).getTime();
        // Se for mídia com base64 muito pesado e mais antigo que o limite
        if (
          msgTime < cutoff &&
          (m.base64 ||
            (m.text && m.text.length > 5000 && m.text.startsWith("data:")))
        ) {
          modified = true;
          cleanedCount++;
        }
      });

      if (modified) {
        await updateLeadWithRaw(lead.id, {}, { _cleanup_before: cutoff });
      }
    }
    offset += leads.length;
    if (leads.length < 250) break;
  }

  revalidatePath("/configuracoes");
  revalidatePath("/conversas");

  return {
    ok: true,
    cleanedCount,
    message:
      cleanedCount > 0
        ? `🧹 Limpeza concluída com sucesso! ${cleanedCount} mídia(s) pesada(s) arquivada(s) para liberar espaço no banco.`
        : "Nenhuma mídia pesada com a idade selecionada foi encontrada nos contatos percorridos.",
  };
}

export async function autoRecoverLeadNamesAction(): Promise<{
  ok: boolean;
  recoveredCount: number;
  message: string;
}> {
  "use server";
  await requireAuth();
  const { listLeads, updateLead } = await import("@/lib/store");

  const leads = await listLeads({ limit: 1000, offset: 0 });
  let recoveredCount = 0;

  for (const lead of leads) {
    // Se o lead já tem nome válido, pula
    if (lead.name && lead.name.trim() && lead.name.trim() !== "Sem Nome")
      continue;

    const raw = lead.raw as Record<string, any> | null;
    let candidateName: string | null = null;

    if (raw) {
      if (typeof raw.pushName === "string" && raw.pushName.trim())
        candidateName = raw.pushName.trim();
      else if (typeof raw.pushname === "string" && raw.pushname.trim())
        candidateName = raw.pushname.trim();
      else if (typeof raw.notifyName === "string" && raw.notifyName.trim())
        candidateName = raw.notifyName.trim();
      else if (typeof raw.notifyname === "string" && raw.notifyname.trim())
        candidateName = raw.notifyname.trim();
      else if (typeof raw.verifiedName === "string" && raw.verifiedName.trim())
        candidateName = raw.verifiedName.trim();
      else if (
        typeof raw.name === "string" &&
        raw.name.trim() &&
        raw.name.trim() !== "Sem Nome"
      )
        candidateName = raw.name.trim();
      else if (
        raw.sender &&
        typeof raw.sender.name === "string" &&
        raw.sender.name.trim()
      )
        candidateName = raw.sender.name.trim();
      else if (Array.isArray(raw.messages)) {
        for (const m of raw.messages) {
          if (typeof m.senderName === "string" && m.senderName.trim()) {
            candidateName = m.senderName.trim();
            break;
          }
          if (typeof m.pushName === "string" && m.pushName.trim()) {
            candidateName = m.pushName.trim();
            break;
          }
        }
      }
    }

    // Se ainda não encontrou no raw, busca nas anotações / propostas do lead (ex: "Cliente: Vilson Gregorio")
    if (!candidateName && lead.notes) {
      const m =
        lead.notes.match(/(?:Cliente|Nome|Lead|Contato):\s*([^\n\r,•*#|]+)/i) ||
        lead.notes.match(
          /👤\s*(?:\*\*)?(?:Cliente|Nome)?(?:\*\*)?:\s*([^\n\r,•*#|]+)/i,
        );
      if (m && m[1].trim() && !/pendente/i.test(m[1])) {
        const extracted = m[1].trim().replace(/^[*_#\s]+|[*_#\s]+$/g, "");
        if (extracted.length >= 2) candidateName = extracted;
      }
    }

    if (candidateName && candidateName.length >= 2) {
      await updateLead(lead.id, { name: candidateName });
      recoveredCount++;
    }
  }

  revalidatePath("/");
  revalidatePath("/conversas");
  revalidatePath("/dashboard");

  return {
    ok: true,
    recoveredCount,
    message:
      recoveredCount > 0
        ? `✅ ${recoveredCount} nome(s) de contato(s) recuperado(s) com sucesso a partir dos metadados do WhatsApp!`
        : "ℹ️ Todos os leads com nomes disponíveis já estão devidamente identificados.",
  };
}
