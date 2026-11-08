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
  /** Notas da proposta (pacote, investimento) — usado como content_name quando o campo é omitido. */
  notes?: string | null;
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
  const isSyntheticClid = clid.startsWith("ctwa_ad_") || clid.startsWith("ad_");
  let hasClid = clid.length > 0 && !forceChat && !isSyntheticClid;
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

  // Correspondência avançada máxima (Event Match Quality — EMQ):
  // Com send_extra_data ativo (padrão) ou sem ctwa_clid, enviamos todos os sinais de
  // identidade hasheados (telefone com variações, nome, e-mail, cidade, estado, CEP, país e ID).
  // Isso atinge pontuação máxima no Meta (EMQ até 10/10) e vincula 100% dos dados.
  if (client.send_extra_data || !hasClid) {
    if (phone) {
      userData.ph = phoneVariants(phone).map(sha256Hex);
    }
    userData.country = [sha256Hex(normalizeCountry(lead.country))];
    userData.external_id = [sha256Hex(lead.id)];

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

  // content_name: usa o campo do formulário; se vazio, usa notes do lead (ex: "Pacote: 18.000 | Investimento: R$ 247")
  const contentName = (input.contentName || "").trim();
  if (contentName) {
    customData.content_name = contentName;
  } else if (lead.notes) {
    // notes do lead (importado via .txt de proposta) — resumo do que foi vendido
    const notes = String(lead.notes || "").trim();
    if (notes) customData.content_name = notes.slice(0, 100); // Meta limita a 100 chars
  }

  if (client.send_extra_data) {
    // content_ids: ID do anúncio de origem — ajuda o Meta a fechar o loop de atribuição
    const effectiveSourceId = lead.source_id || (lead.ctwa_clid?.startsWith("ctwa_ad_") ? lead.ctwa_clid.replace("ctwa_ad_", "") : null);
    if (effectiveSourceId) {
      customData.content_ids = [effectiveSourceId];
      customData.ctwa_source_id = effectiveSourceId;
    }
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

  // Estratégia de fallback progressivo — do mais completo ao mais simples
  const attempts = [
    // 1. Completa: anúncio com conjunto, campanha e criativo expandido (inclui object_story_spec para texto real)
    {
      url: `${base}?fields=name,effective_status,adset{id,name},campaign{id,name},creative{id,title,body,thumbnail_url,image_url,object_story_spec{link_data{message,description,image_hash},video_data{message,image_url},photo_data{caption}}}&access_token=${token}`,
      type: "ad_full",
    },
    // 2. Criativo sem object_story_spec (compatibilidade)
    {
      url: `${base}?fields=name,effective_status,adset{id,name},campaign{id,name},creative{id,title,body,thumbnail_url,image_url}&access_token=${token}`,
      type: "ad_creative",
    },
    // 3. Segura: campos padrão sem criativo aninhado
    {
      url: `${base}?fields=name,status,adset{id,name},campaign{id,name}&access_token=${token}`,
      type: "ad_safe",
    },
    // 4. Básica: apenas nome
    {
      url: `${base}?fields=name&access_token=${token}`,
      type: "ad_basic",
    },
    // 5. Caso o ID seja de um conjunto de anúncios
    {
      url: `${base}?fields=name,campaign{id,name}&access_token=${token}`,
      type: "adset",
    },
    // 6. Caso o ID seja de uma campanha
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
          // Token inválido/expirado — não adianta tentar outros campos
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

  // ── Insights: busca métricas completas ─────────────────────────────────────
  let insights: Record<string, unknown> | null = null;
  try {
    const insRes = await doFetch(
      `${base}/insights?fields=spend,impressions,clicks,unique_clicks,reach,actions,action_values&date_preset=maximum&access_token=${token}`,
      { cache: "no-store" }
    );
    const insJson = (await insRes.json()) as { data?: Record<string, unknown>[] };
    insights = insRes.ok && Array.isArray(insJson.data) ? insJson.data[0] ?? null : null;
  } catch {
    insights = null;
  }

  // ── Criativo expandido: se não veio thumbnail, busca o criativo separado ──
  const creative = (adJson.creative || {}) as Record<string, unknown>;
  let thumbnailUrl = str(creative.image_url) ?? str(creative.thumbnail_url);
  let creativeTitle = str(creative.title);
  let creativeBody = str(creative.body);

  // Tenta extrair texto do object_story_spec (texto real do anúncio)
  const storySpec = (creative.object_story_spec || {}) as Record<string, unknown>;
  const linkData = (storySpec.link_data || {}) as Record<string, unknown>;
  const videoData = (storySpec.video_data || {}) as Record<string, unknown>;
  const photoData = (storySpec.photo_data || {}) as Record<string, unknown>;
  const storyMessage = str(linkData.message) ?? str(videoData.message) ?? str(photoData.caption);
  const storyDescription = str(linkData.description);

  // Se o criativo tem texto real do anúncio e o body estava vazio, usa o texto real
  if (!creativeBody && storyMessage) creativeBody = storyMessage;
  if (!creativeTitle && storyDescription) creativeTitle = storyDescription;

  // Se ainda não tem thumbnail e temos o creative_id, busca o criativo separado
  const creativeId = str(creative.id);
  if (!thumbnailUrl && creativeId) {
    try {
      const creativeRes = await doFetch(
        `${GRAPH}/${opts.apiVersion}/${creativeId}?fields=thumbnail_url,image_url,body,title,object_story_spec{link_data{image_hash,picture,message},video_data{image_url,message}}&access_token=${token}`,
        { cache: "no-store" }
      );
      const creativeJson = (await creativeRes.json()) as Record<string, unknown>;
      if (creativeRes.ok && !creativeJson.error) {
        thumbnailUrl = str(creativeJson.image_url) ?? str(creativeJson.thumbnail_url);
        if (!creativeTitle) creativeTitle = str(creativeJson.title);
        if (!creativeBody) creativeBody = str(creativeJson.body);
        // Tenta extrair thumbnail do object_story_spec do criativo separado
        const cs = (creativeJson.object_story_spec || {}) as Record<string, unknown>;
        const ld = (cs.link_data || {}) as Record<string, unknown>;
        const vd = (cs.video_data || {}) as Record<string, unknown>;
        if (!thumbnailUrl) thumbnailUrl = str(ld.picture) ?? str(vd.image_url);
        if (!creativeBody) creativeBody = str(ld.message) ?? str(vd.message);
      }
    } catch {
      // Não bloqueia — fallback sem thumbnail
    }
  }

  // ── Ações do Meta: identifica conversas e purchase ─────────────────────────
  const adset = (adJson.adset || {}) as Record<string, unknown>;
  const campaign = (adJson.campaign || {}) as Record<string, unknown>;
  const actions = Array.isArray(insights?.actions)
    ? (insights!.actions as { action_type?: string; value?: string }[])
    : [];

  // Conversas iniciadas — todos os tipos que o Meta reporta
  const CONV_ACTION_TYPES = [
    "onsite_conversion.messaging_conversation_started_7d",
    "messaging_conversation_started",
    "onsite_conversion.messaging_first_reply",
    "click_to_message_conversations_started",
  ];
  const convActions = actions.filter((a) => CONV_ACTION_TYPES.some((t) => (a.action_type || "").includes(t)));
  const conversations = convActions.reduce((sum, a) => sum + (Number(a.value) || 0), 0) || null;

  // Compras via action_values
  const actionValues = Array.isArray(insights?.action_values)
    ? (insights!.action_values as { action_type?: string; value?: string }[])
    : [];
  const purchaseVal = actionValues.find((a) => (a.action_type || "") === "purchase");
  const purchaseValue = purchaseVal ? num(purchaseVal.value) : null;

  return {
    ok: true,
    ad: {
      ad_name: str(adJson.name),
      ad_status: str(adJson.effective_status) || str(adJson.status),
      adset_id: str(adset.id) || (successType === "adset" ? opts.adId : null),
      adset_name: str(adset.name) || (successType === "adset" ? str(adJson.name) : null),
      campaign_id: str(campaign.id) || (successType === "campaign" ? opts.adId : null),
      campaign_name: str(campaign.name) || (successType === "campaign" ? str(adJson.name) : null),
      creative_title: creativeTitle,
      creative_body: creativeBody,
      thumbnail_url: thumbnailUrl,
      spend: num(insights?.spend),
      impressions: num(insights?.impressions),
      clicks: num(insights?.clicks),
      conversations,
      raw: { ad: adJson, insights, successType, purchaseValue },
    },
  };
}

// ---------------------------------------------------------------------------
// Consulta Completa da Conta de Anúncios (act_...) com Gastos e Campanhas
// ---------------------------------------------------------------------------

export async function fetchAdAccountAdsAndInsights(opts: {
  apiVersion: string;
  adAccountId?: string | null;
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<{ ok: true; ads: FetchedAd[]; accountId: string } | { ok: false; error: string }> {
  const doFetch = opts.fetchImpl ?? fetch;
  const token = encodeURIComponent(opts.accessToken);

  let targetAccountId = (opts.adAccountId || "").trim();

  // Se não foi informado ad_account_id, tenta descobrir automaticamente via /me/adaccounts
  if (!targetAccountId) {
    try {
      const meRes = await doFetch(
        `${GRAPH}/${opts.apiVersion}/me/adaccounts?fields=id,name,account_id&limit=1&access_token=${token}`,
        { cache: "no-store" }
      );
      const meJson = (await meRes.json()) as { data?: { id?: string; account_id?: string }[]; error?: unknown };
      if (meRes.ok && Array.isArray(meJson.data) && meJson.data.length > 0) {
        targetAccountId = meJson.data[0]?.id || meJson.data[0]?.account_id || "";
      }
    } catch {
      // Ignora e continua
    }
  }

  if (!targetAccountId) {
    return { ok: false, error: "ID da conta de anúncios (act_...) não informado e não encontrado na conta." };
  }

  const actId = targetAccountId.startsWith("act_")
    ? targetAccountId
    : `act_${targetAccountId.replace(/\D/g, "")}`;

  // 1. Tenta buscar todos os anúncios com criativos, campanhas e insights de gasto
  try {
    const url = `${GRAPH}/${opts.apiVersion}/${encodeURIComponent(actId)}/ads?fields=id,name,status,effective_status,campaign{id,name},adset{id,name},creative{id,title,body,thumbnail_url,image_url},insights.date_preset(maximum){spend,impressions,clicks,actions}&limit=150&access_token=${token}`;
    const res = await doFetch(url, { cache: "no-store" });
    const json = (await res.json()) as { data?: Record<string, unknown>[]; error?: Record<string, unknown> };

    if (!res.ok || json.error) {
      const err = describeMetaError(json) || "Erro ao consultar conta de anúncios";
      return { ok: false, error: err };
    }

    const list = Array.isArray(json.data) ? json.data : [];
    const ads: FetchedAd[] = [];

    for (const item of list) {
      const adId = String(item.id || "");
      if (!adId) continue;

      const campaign = (item.campaign || {}) as Record<string, unknown>;
      const adset = (item.adset || {}) as Record<string, unknown>;
      const creative = (item.creative || {}) as Record<string, unknown>;
      const insightsList = ((item.insights as Record<string, unknown>)?.data || []) as Record<string, unknown>[];
      const insights = insightsList[0] || null;

      const actions = Array.isArray(insights?.actions)
        ? (insights!.actions as { action_type?: string; value?: string }[])
        : [];
      const convActions = actions.filter((a) =>
        (a.action_type || "").includes("messaging_conversation_started")
      );
      const conversations = convActions.reduce((sum, a) => sum + (Number(a.value) || 0), 0) || null;

      ads.push({
        ad_name: str(item.name),
        ad_status: str(item.effective_status) || str(item.status),
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
        conversations,
        raw: { item, insights },
      });
    }

    return { ok: true, ads, accountId: actId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
