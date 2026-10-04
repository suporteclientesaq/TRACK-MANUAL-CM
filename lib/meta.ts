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
  /** Força o envio como conversa/chat (casado por telefone), ignorando o ctwa_clid. */
  forceChat?: boolean;
  /** Se verdadeiro, quando não houver page_id nem waba_id, não bloqueia com erro e sim envia como chat. */
  allowFallbackWithoutPageId?: boolean;
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
 * Com ctwa_clid e ID de Página: evento de mensagem de empresa (business_messaging / whatsapp).
 * Sem ctwa_clid ou sem Página: evento de conversa (chat) casado pelo telefone com hash —
 * padrão de ponta a ponta sem burocracia (basta Pixel + Token).
 */
export function buildEvent(input: BuildEventInput): BuiltEvent {
  const { client, lead, forceChat, allowFallbackWithoutPageId } = input;
  const warnings: string[] = [];
  const errors: string[] = [];
  const now = input.now ?? new Date();

  const clid = (lead.ctwa_clid || "").trim();
  const page = (client.page_id || "").trim();
  const waba = (client.waba_id || "").trim();
  const hasPageOrWaba = Boolean(page || waba);

  // Define se vai como business_messaging ou chat
  let hasClid = clid.length > 0 && !forceChat;
  let actionSource: "business_messaging" | "chat" = hasClid ? "business_messaging" : "chat";

  // Se tem ctwa_clid mas não tem ID de Página/WABA:
  if (hasClid && !hasPageOrWaba) {
    if (allowFallbackWithoutPageId) {
      // Modo sem burocracia: envia pelo telefone sem travar o usuário
      hasClid = false;
      actionSource = "chat";
      warnings.push("Cliente sem ID da Página cadastrado. Enviando via correspondência por telefone (Meta Chat).");
    } else {
      errors.push(
        "Cadastre no cliente o ID da Página ou o ID da Conta do WhatsApp Business. Sem um deles o Meta não aceita o ctwa_clid."
      );
    }
  }

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
    }
  } else {
    if (!forceChat && clid.length > 0) {
      // Estava com clid mas foi convertido para chat
    } else if (!clid) {
      warnings.push(
        "Este lead não tem ctwa_clid. O evento vai como conversa, casado só pelo telefone, e o Meta pode não atribuir ao anúncio."
      );
    }
    if (!phone) errors.push("Sem ctwa_clid e sem telefone válido não há como o Meta identificar a pessoa.");
  }

  // Correspondência avançada máxima (Event Match Quality):
  // Sempre envia telefone e dados de usuário quando disponíveis para maximizar o match no Meta.
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
// Envio com Recuperação Automática Inteligente
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
  /** Indica se o evento foi recuperado automaticamente após rejeição do ctwa_clid/page_id. */
  recovered?: boolean;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function describeMetaError(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const err = (json as { error?: Record<string, unknown> }).error;
  if (!err) return null;

  const code = err.code !== undefined ? Number(err.code) : null;
  const subcode = err.error_subcode !== undefined ? Number(err.error_subcode) : null;

  const parts = [err.error_user_title, err.error_user_msg, err.message]
    .filter((p): p is string => typeof p === "string" && p.length > 0);
  const unique = [...new Set(parts)];
  const rawMsg = unique.join(" — ");

  let hint = "";
  if (code === 190 || code === 102) {
    hint = "Token da API expirou ou é inválido. Gere um novo token no Gerenciador de Eventos do Meta.";
  } else if (subcode === 2804065) {
    hint = "A identificação da Página não corresponde a este conjunto de dados.";
  } else if (subcode === 2804072) {
    hint = "O ctwa_clid e o ID da Página não correspondem ao mesmo anúncio/conta.";
  } else if (subcode === 2804019) {
    hint = "O ctwa_clid é inválido ou expirou.";
  } else if (code === 100 && subcode === 33) {
    hint = "Permissões insuficientes ou objeto inacessível (ads_read).";
  }

  const codeStr = code !== null ? ` (código ${code}${subcode ? `/${subcode}` : ""})` : "";
  const fullText = [rawMsg, hint].filter(Boolean).join(" — ") || "Erro desconhecido do Meta";
  return fullText + codeStr;
}

/** Verifica se um erro do Meta é passível de recuperação automática via telefone puro (chat). */
function isRecoverableCtwaError(json: unknown): boolean {
  if (!json || typeof json !== "object") return false;
  const err = (json as { error?: Record<string, unknown> }).error;
  if (!err) return false;
  const subcode = Number(err.error_subcode);
  const code = Number(err.code);
  const msg = String(err.message || "").toLowerCase();

  // Subcódigos conhecidos de falha de CTWA / Page ID:
  // 2804065 = Page ID not associated with dataset
  // 2804072 = Page ID / ctwa_clid mismatch
  // 2804019 = Invalid/expired ctwa_clid
  if (subcode === 2804065 || subcode === 2804072 || subcode === 2804019) return true;

  // Erros de parâmetro relacionados a page_id ou ctwa_clid
  if (code === 100 && (msg.includes("page_id") || msg.includes("ctwa_clid") || msg.includes("business_messaging"))) {
    return true;
  }
  return false;
}

export async function sendEvent(opts: {
  apiVersion: string;
  pixelId: string;
  accessToken: string;
  event: Record<string, unknown>;
  testEventCode?: string | null;
  fetchImpl?: FetchLike;
  autoFallback?: boolean;
}): Promise<SendResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const autoFallback = opts.autoFallback ?? true;

  const execSend = async (ev: Record<string, unknown>) => {
    const body: Record<string, unknown> = { data: [ev], partner_agent: "track-manual" };
    const testCode = (opts.testEventCode || "").trim();
    if (testCode) body.test_event_code = testCode;

    const url = `${GRAPH}/${opts.apiVersion}/${encodeURIComponent(opts.pixelId)}/events`;
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
        rawJson: null,
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
      rawJson: json,
    };
  };

  // Primeira tentativa de envio (com os dados originais)
  const first = await execSend(opts.event);
  if (first.ok) return first;

  // Se deu erro e o evento usava business_messaging com ctwa_clid ou page_id:
  const isBm = opts.event.action_source === "business_messaging";
  if (autoFallback && isBm && isRecoverableCtwaError(first.rawJson)) {
    // ---- RECUPERAÇÃO AUTOMÁTICA INTELIGENTE ----
    // Remove os parâmetros problemáticos (page_id / ctwa_clid) e envia como chat casado por telefone.
    const fallbackEvent: Record<string, unknown> = {
      ...opts.event,
      action_source: "chat",
    };
    delete fallbackEvent.messaging_channel;

    const uData = { ...((opts.event.user_data as Record<string, unknown>) || {}) };
    delete uData.ctwa_clid;
    delete uData.page_id;
    delete uData.whatsapp_business_account_id;
    fallbackEvent.user_data = uData;

    const second = await execSend(fallbackEvent);
    if (second.ok) {
      return {
        ...second,
        recovered: true,
      };
    }
  }

  return first;
}

// ---------------------------------------------------------------------------
// Consulta do anúncio (API de Marketing) com Fallback Progressivo
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

  // Estratégia de fallback progressivo em 4 tentativas:
  const attempts = [
    // 1. Completa: anúncio com conjunto, campanha e criativo
    {
      url: `${base}?fields=name,effective_status,adset{id,name},campaign{id,name},creative{title,body,thumbnail_url,image_url}&access_token=${token}`,
      type: "ad_full",
    },
    // 2. Segura: campos padrão sem criativo aninhado
    {
      url: `${base}?fields=name,status,adset{id,name},campaign{id,name}&access_token=${token}`,
      type: "ad_safe",
    },
    // 3. Básica: apenas nome
    {
      url: `${base}?fields=name&access_token=${token}`,
      type: "ad_basic",
    },
    // 4. Caso o ID seja de um conjunto de anúncios
    {
      url: `${base}?fields=name,campaign{id,name}&access_token=${token}`,
      type: "adset",
    },
    // 5. Caso o ID seja de uma campanha
    {
      url: `${base}?fields=name&access_token=${token}`,
      type: "campaign",
    },
  ];

  let adJson: Record<string, unknown> = {};
  let successType = "";
  let lastError = "";

  for (const attempt of attempts) {
    try {
      const res = await doFetch(attempt.url, { cache: "no-store" });
      const json = (await res.json()) as Record<string, unknown>;
      if (res.ok && !json.error && json.name) {
        adJson = json;
        successType = attempt.type;
        break;
      }
      if (json.error) {
        lastError = describeMetaError(json) || "Erro ao consultar Meta";
        const errObj = json.error as Record<string, unknown>;
        if (errObj.code === 190 || errObj.code === 102) {
          // Token inválido/expirado não adianta tentar outros campos
          return { ok: false, error: lastError };
        }
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  if (!adJson.name) {
    return { ok: false, error: lastError || "Não foi possível carregar os dados deste anúncio do Meta." };
  }

  // Tenta buscar métricas de insights (não bloqueante)
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
      ad_status: str(adJson.effective_status) || str(adJson.status),
      adset_id: str(adset.id) || (successType === "adset" ? opts.adId : null),
      adset_name: str(adset.name) || (successType === "adset" ? str(adJson.name) : null),
      campaign_id: str(campaign.id) || (successType === "campaign" ? opts.adId : null),
      campaign_name: str(campaign.name) || (successType === "campaign" ? str(adJson.name) : null),
      creative_title: str(creative.title),
      creative_body: str(creative.body),
      thumbnail_url: str(creative.image_url) ?? str(creative.thumbnail_url),
      spend: num(insights?.spend),
      impressions: num(insights?.impressions),
      clicks: num(insights?.clicks),
      conversations: conv ? num(conv.value) : null,
      raw: { ad: adJson, insights, successType },
    },
  };
}
