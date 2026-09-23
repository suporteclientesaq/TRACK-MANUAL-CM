import { sha256Hex } from "./crypto";
import {
  normalizeCity,
  normalizeCountry,
  normalizeEmail,
  normalizePhone,
  normalizeState,
  normalizeZip,
  phoneVariants,
  splitName,
} from "./normalize";
import type { IdMode } from "./types";

// META_GRAPH_URL existe só para os testes de ponta a ponta apontarem para um Meta falso.
const GRAPH = (process.env.META_GRAPH_URL || "https://graph.facebook.com").replace(/\/+$/, "");
const SEVEN_DAYS_S = 7 * 24 * 60 * 60;

export interface EventClientConfig {
  page_id: string | null;
  waba_id: string | null;
  id_mode: IdMode;
  send_extra_data: boolean;
}

export interface EventLeadData {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  ctwa_clid: string | null;
  source_id: string | null;
  source_url: string | null;
}

export interface BuildEventInput {
  client: EventClientConfig;
  lead: EventLeadData;
  eventName: string;
  eventId: string;
  eventTime: Date;
  now?: Date;
  value?: number | null;
  currency?: string | null;
  contentName?: string | null;
}

export interface BuiltEvent {
  event: Record<string, unknown>;
  actionSource: "business_messaging" | "chat";
  /** Avisos que não impedem o envio. */
  warnings: string[];
  /** Problemas que impedem o envio. */
  errors: string[];
}

/**
 * Monta o evento da API de Conversões.
 *
 * Com ctwa_clid: evento de mensagem de empresa (business_messaging / whatsapp),
 * que é o que liga a conversão ao clique no anúncio Click-to-WhatsApp.
 * Sem ctwa_clid: evento de conversa (chat) casado só pelo telefone com hash —
 * serve para públicos e medição, mas a atribuição ao anúncio é bem mais fraca.
 */
export function buildEvent(input: BuildEventInput): BuiltEvent {
  const { client, lead } = input;
  const warnings: string[] = [];
  const errors: string[] = [];
  const now = input.now ?? new Date();

  const clid = (lead.ctwa_clid || "").trim();
  const hasClid = clid.length > 0;
  const actionSource = hasClid ? "business_messaging" : "chat";

  // ---- horário do evento ---------------------------------------------------
  const eventTimeS = Math.floor(input.eventTime.getTime() / 1000);
  const nowS = Math.floor(now.getTime() / 1000);
  if (!Number.isFinite(eventTimeS)) {
    errors.push("Data do evento inválida.");
  } else if (eventTimeS > nowS + 60) {
    errors.push("A data do evento está no futuro. O Meta recusa eventos futuros.");
  } else if (nowS - eventTimeS > SEVEN_DAYS_S) {
    warnings.push(
      "O evento tem mais de 7 dias. O Meta costuma recusar ou ignorar eventos tão antigos."
    );
  }

  // ---- dados do usuário ----------------------------------------------------
  const userData: Record<string, unknown> = {};
  const phone = normalizePhone(lead.phone);

  if (hasClid) {
    userData.ctwa_clid = clid; // vai em texto puro, sem hash (exigência do Meta)

    const page = (client.page_id || "").trim();
    const waba = (client.waba_id || "").trim();
    if (client.id_mode === "waba" && waba) {
      userData.whatsapp_business_account_id = waba;
    } else if (client.id_mode === "page" && page) {
      userData.page_id = page;
    } else if (page) {
      userData.page_id = page;
      warnings.push("ID da Conta do WhatsApp Business não cadastrado; usando o ID da Página.");
    } else if (waba) {
      userData.whatsapp_business_account_id = waba;
      warnings.push("ID da Página não cadastrado; usando o ID da Conta do WhatsApp Business.");
    } else {
      errors.push(
        "Cadastre no cliente o ID da Página ou o ID da Conta do WhatsApp Business. Sem um deles o Meta não aceita o ctwa_clid."
      );
    }
  } else {
    warnings.push(
      "Este lead não tem ctwa_clid. O evento vai como conversa, casado só pelo telefone, e o Meta pode não atribuir ao anúncio."
    );
    if (!phone) errors.push("Sem ctwa_clid e sem telefone válido não há como o Meta identificar a pessoa.");
  }

  // Sem ctwa_clid o telefone é a única chave, então os dados extras vão sempre.
  if (client.send_extra_data || !hasClid) {
    if (phone) userData.ph = phoneVariants(phone).map(sha256Hex);
    const email = normalizeEmail(lead.email);
    if (email) userData.em = [sha256Hex(email)];
    const { fn, ln } = splitName(lead.name);
    if (fn) userData.fn = [sha256Hex(fn)];
    if (ln) userData.ln = [sha256Hex(ln)];
    const ct = normalizeCity(lead.city);
    if (ct) userData.ct = [sha256Hex(ct)];
    const st = normalizeState(lead.state);
    if (st) userData.st = [sha256Hex(st)];
    const zp = normalizeZip(lead.zip);
    if (zp) userData.zp = [sha256Hex(zp)];
    userData.country = [sha256Hex(normalizeCountry(lead.country))];
    userData.external_id = [sha256Hex(lead.id)];
  }

  // ---- dados da conversão --------------------------------------------------
  const customData: Record<string, unknown> = {};
  const isPurchase = input.eventName === "Purchase";
  const value = input.value ?? null;
  if (value !== null) {
    if (!Number.isFinite(value) || value < 0) errors.push("Valor inválido.");
    else customData.value = value;
  }
  if (isPurchase && (value === null || value <= 0)) {
    errors.push("Compra precisa de um valor maior que zero.");
  }
  if (customData.value !== undefined) {
    const currency = (input.currency || "BRL").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) errors.push("Moeda inválida. Use o código de 3 letras, como BRL.");
    else customData.currency = currency;
  }
  const contentName = (input.contentName || "").trim();
  if (contentName) customData.content_name = contentName;

  if (client.send_extra_data) {
    // Propriedades personalizadas: não mudam a atribuição (quem atribui é o
    // ctwa_clid), mas ficam disponíveis para regras de conversão personalizada.
    if (lead.source_id) customData.ctwa_source_id = lead.source_id;
    if (lead.source_url) customData.ctwa_source_url = lead.source_url;
  }

  // Fora de mensagens de empresa, "LeadSubmitted" não é evento padrão: o padrão é "Lead".
  const eventName = !hasClid && input.eventName === "LeadSubmitted" ? "Lead" : input.eventName;

  const event: Record<string, unknown> = {
    event_name: eventName,
    event_time: eventTimeS,
    event_id: input.eventId,
    action_source: actionSource,
    user_data: userData,
  };
  if (hasClid) event.messaging_channel = "whatsapp";
  if (Object.keys(customData).length > 0) event.custom_data = customData;

  return { event, actionSource, warnings, errors };
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

export interface SendResult {
  ok: boolean;
  httpStatus: number;
  eventsReceived: number | null;
  fbtraceId: string | null;
  errorMessage: string | null;
  response: unknown;
  /** Corpo enviado, sem o token. É isto que fica salvo no histórico. */
  body: Record<string, unknown>;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function describeMetaError(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const err = (json as { error?: Record<string, unknown> }).error;
  if (!err) return null;
  const parts = [err.error_user_title, err.error_user_msg, err.message]
    .filter((p): p is string => typeof p === "string" && p.length > 0);
  const unique = [...new Set(parts)];
  const code = err.code !== undefined ? ` (código ${err.code}${err.error_subcode ? `/${err.error_subcode}` : ""})` : "";
  return (unique.join(" — ") || "Erro desconhecido do Meta") + code;
}

export async function sendEvent(opts: {
  apiVersion: string;
  pixelId: string;
  accessToken: string;
  event: Record<string, unknown>;
  testEventCode?: string | null;
  fetchImpl?: FetchLike;
}): Promise<SendResult> {
  const body: Record<string, unknown> = { data: [opts.event], partner_agent: "track-manual" };
  const testCode = (opts.testEventCode || "").trim();
  if (testCode) body.test_event_code = testCode;

  const url = `${GRAPH}/${opts.apiVersion}/${encodeURIComponent(opts.pixelId)}/events`;
  const doFetch = opts.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await doFetch(`${url}?access_token=${encodeURIComponent(opts.accessToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (e) {
    return {
      ok: false,
      httpStatus: 0,
      eventsReceived: null,
      fbtraceId: null,
      errorMessage: `Não foi possível falar com o Meta: ${e instanceof Error ? e.message : String(e)}`,
      response: null,
      body,
    };
  }

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  const obj = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const received = typeof obj.events_received === "number" ? obj.events_received : null;
  const errObj = obj.error as Record<string, unknown> | undefined;
  const fbtrace =
    (typeof obj.fbtrace_id === "string" && obj.fbtrace_id) ||
    (errObj && typeof errObj.fbtrace_id === "string" && errObj.fbtrace_id) ||
    null;
  const ok = res.ok && received !== null && received > 0;

  return {
    ok,
    httpStatus: res.status,
    eventsReceived: received,
    fbtraceId: fbtrace,
    errorMessage: ok
      ? null
      : describeMetaError(json) ?? `O Meta respondeu ${res.status} sem confirmar o recebimento.`,
    response: json,
    body,
  };
}

// ---------------------------------------------------------------------------
// Consulta do anúncio (API de Marketing)
// ---------------------------------------------------------------------------

export interface FetchedAd {
  ad_name: string | null;
  ad_status: string | null;
  adset_id: string | null;
  adset_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  creative_title: string | null;
  creative_body: string | null;
  thumbnail_url: string | null;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  conversations: number | null;
  raw: unknown;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

export async function fetchAd(opts: {
  apiVersion: string;
  adId: string;
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<{ ok: true; ad: FetchedAd } | { ok: false; error: string }> {
  if (!/^\d{6,}$/.test(opts.adId)) {
    return { ok: false, error: "O ID de origem deste lead não parece um ID de anúncio do Meta." };
  }
  const doFetch = opts.fetchImpl ?? fetch;
  const token = encodeURIComponent(opts.accessToken);
  const base = `${GRAPH}/${opts.apiVersion}/${opts.adId}`;
  const fields =
    "name,effective_status,adset{id,name},campaign{id,name},creative{title,body,thumbnail_url,image_url}";

  try {
    const adRes = await doFetch(`${base}?fields=${encodeURIComponent(fields)}&access_token=${token}`, {
      cache: "no-store",
    });
    const adJson = (await adRes.json()) as Record<string, unknown>;
    if (!adRes.ok || adJson.error) {
      return { ok: false, error: describeMetaError(adJson) ?? `O Meta respondeu ${adRes.status}.` };
    }

    // Os números de desempenho são um extra: se falharem, os nomes ainda voltam.
    let insights: Record<string, unknown> | null = null;
    try {
      const insRes = await doFetch(
        `${base}/insights?fields=spend,impressions,clicks,actions&date_preset=maximum&access_token=${token}`,
        { cache: "no-store" }
      );
      const insJson = (await insRes.json()) as { data?: Record<string, unknown>[] };
      insights = insRes.ok && Array.isArray(insJson.data) ? insJson.data[0] ?? null : null;
    } catch {
      insights = null;
    }

    const adset = (adJson.adset || {}) as Record<string, unknown>;
    const campaign = (adJson.campaign || {}) as Record<string, unknown>;
    const creative = (adJson.creative || {}) as Record<string, unknown>;
    const actions = Array.isArray(insights?.actions)
      ? (insights!.actions as { action_type?: string; value?: string }[])
      : [];
    const conv = actions.find((a) =>
      (a.action_type || "").includes("messaging_conversation_started")
    );

    return {
      ok: true,
      ad: {
        ad_name: str(adJson.name),
        ad_status: str(adJson.effective_status),
        adset_id: str(adset.id),
        adset_name: str(adset.name),
        campaign_id: str(campaign.id),
        campaign_name: str(campaign.name),
        creative_title: str(creative.title),
        creative_body: str(creative.body),
        thumbnail_url: str(creative.image_url) ?? str(creative.thumbnail_url),
        spend: num(insights?.spend),
        impressions: num(insights?.impressions),
        clicks: num(insights?.clicks),
        conversations: conv ? num(conv.value) : null,
        raw: { ad: adJson, insights },
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: `Não foi possível falar com o Meta: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
