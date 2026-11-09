import { selectReferralGroups } from "./ctwa";
import { normalizePhone, ufFromPhone } from "./normalize";

/**
 * Parser de Webhook da Evolution API (v1 e v2) / Baileys.
 * Extrai automaticamente os dados do lead, ctwa_clid e anúncio quando
 * uma nova mensagem Click-to-WhatsApp chega no WhatsApp.
 */

export interface ParsedEvolutionLead {
  name: string | null;
  phone: string;
  ctwa_clid: string | null;
  source_id: string | null;
  source_url: string | null;
  thumbnail_url: string | null;
  media_url: string | null;
  headline: string | null;
  ad_body: string | null;
  message_text: string | null;
  instance: string | null;
  fromMe: boolean;
  message_id: string | null;
  received_at: string | null;
  type: "text" | "image" | "audio" | "video" | "document";
  mimetype: string | null;
  message_media_url: string | null;
  base64: string | null;
  filename: string | null;
}

/** LIDs identify a WhatsApp account, not a dialable phone number. */
export function phoneFromWhatsAppJid(
  jid: unknown,
  alternate?: unknown,
): string | null {
  const value = typeof jid === "string" ? jid : "";
  if (!value || /@(g\.us|broadcast|newsletter)$/.test(value)) return null;
  if (value.endsWith("@lid")) {
    const alt = typeof alternate === "string" ? alternate : "";
    if (!alt || alt.endsWith("@lid")) return null;
    return phoneFromWhatsAppJid(alt);
  }
  return normalizePhone(
    value.replace(/@.*$/, "").split(":")[0].replace(/\D/g, ""),
  );
}

export function whatsappTimestamp(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric =
    typeof value === "object" && value && "low" in value
      ? Number((value as { low: unknown }).low)
      : Number(value);
  const date =
    Number.isFinite(numeric) && numeric > 0
      ? new Date(numeric < 1e12 ? numeric * 1000 : numeric)
      : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function parseEvolutionWebhook(
  payload: Record<string, unknown>,
  options: { includeOutgoing?: boolean } = {},
):
  | { ok: true; lead: ParsedEvolutionLead }
  | { ok: false; ignored?: boolean; error: string } {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "Payload inválido ou vazio." };
  }

  const instance =
    typeof payload.instance === "string" ? payload.instance : null;

  // Evolution API manda dados em "data", que pode ser objeto ou array
  let item = payload.data as Record<string, unknown> | undefined;
  if (Array.isArray(payload.data) && payload.data.length > 0) {
    item = payload.data[0] as Record<string, unknown>;
  }

  // Se não tiver campo data, tenta o próprio payload
  if (!item || typeof item !== "object") {
    item = payload;
  }

  // Verifica chave da mensagem (remoteJid, fromMe)
  const key = (item.key || {}) as Record<string, unknown>;
  const fromMe = Boolean(key.fromMe || item.fromMe);
  if (fromMe && !options.includeOutgoing) {
    return {
      ok: false,
      ignored: true,
      error: "Mensagem enviada pelo próprio número (fromMe: true).",
    };
  }

  const rawJid = String(key.remoteJid || item.remoteJid || item.phone || "");
  if (!rawJid) {
    return {
      ok: false,
      error: "Nenhum remoteJid ou telefone encontrado no webhook.",
    };
  }

  // Ignora mensagens de grupos (@g.us), status/stories (@broadcast)
  if (rawJid.includes("@g.us") || rawJid.includes("@broadcast")) {
    return {
      ok: false,
      ignored: true,
      error: "Mensagem de grupo ou broadcast ignorada.",
    };
  }

  const phone = phoneFromWhatsAppJid(
    rawJid,
    key.remoteJidAlt || item.remoteJidAlt || item.senderPn,
  );
  if (!phone) {
    if (rawJid.endsWith("@lid"))
      return {
        ok: false,
        ignored: true,
        error: "Identificador LID sem telefone resolvido.",
      };
    return {
      ok: false,
      error: `Telefone inválido extraído do remoteJid: ${rawJid}`,
    };
  }

  const name = fromMe
    ? null
    : typeof item.pushName === "string" && item.pushName.trim()
      ? item.pushName.trim()
      : typeof item.verifiedName === "string" && item.verifiedName.trim()
        ? item.verifiedName.trim()
        : null;

  // Unwraps wrapper message types (ephemeral, viewOnce, documentWithCaption)
  let rawMessage = (item.message || {}) as Record<string, unknown>;
  let depth = 0;
  while (depth < 5) {
    depth++;
    const inner =
      (rawMessage.ephemeralMessage as Record<string, unknown>)?.message ||
      (rawMessage.viewOnceMessage as Record<string, unknown>)?.message ||
      (rawMessage.viewOnceMessageV2 as Record<string, unknown>)?.message ||
      (rawMessage.documentWithCaptionMessage as Record<string, unknown>)
        ?.message;
    if (inner && typeof inner === "object") {
      rawMessage = inner as Record<string, unknown>;
    } else {
      break;
    }
  }

  // Extrai texto da conversa de múltiplos formatos possíveis
  const ext = (rawMessage.extendedTextMessage || {}) as Record<string, unknown>;
  const img = (rawMessage.imageMessage || {}) as Record<string, unknown>;
  const vid = (rawMessage.videoMessage || {}) as Record<string, unknown>;
  const doc = (rawMessage.documentMessage || {}) as Record<string, unknown>;
  const btn = (rawMessage.buttonsResponseMessage || {}) as Record<
    string,
    unknown
  >;
  const tpl = (rawMessage.templateButtonReplyMessage || {}) as Record<
    string,
    unknown
  >;
  const aud = (rawMessage.audioMessage || {}) as Record<string, unknown>;
  const messageType = rawMessage.imageMessage
    ? "image"
    : rawMessage.audioMessage
      ? "audio"
      : rawMessage.videoMessage
        ? "video"
        : rawMessage.documentMessage
          ? "document"
          : "text";
  const attachment =
    messageType === "image"
      ? img
      : messageType === "audio"
        ? aud
        : messageType === "video"
          ? vid
          : doc;

  const conversation =
    typeof rawMessage.conversation === "string" &&
    rawMessage.conversation.trim()
      ? rawMessage.conversation.trim()
      : typeof ext.text === "string" && ext.text.trim()
        ? ext.text.trim()
        : typeof img.caption === "string" && img.caption.trim()
          ? img.caption.trim()
          : typeof vid.caption === "string" && vid.caption.trim()
            ? vid.caption.trim()
            : typeof doc.caption === "string" && doc.caption.trim()
              ? doc.caption.trim()
              : typeof btn.selectedButtonText === "string" &&
                  btn.selectedButtonText.trim()
                ? btn.selectedButtonText.trim()
                : typeof tpl.selectedDisplayText === "string" &&
                    tpl.selectedDisplayText.trim()
                  ? tpl.selectedDisplayText.trim()
                  : null;

  // A provider context is one referral. Never fill its missing click/ad fields
  // with values from an unrelated context or from the webhook root.
  const referral = selectReferralGroups([
    ext.contextInfo,
    img.contextInfo,
    vid.contextInfo,
    doc.contextInfo,
    aud.contextInfo,
    rawMessage.contextInfo,
    item.contextInfo,
    {
      ctwa_clid: item._baileys_ctwa_clid,
      source_id: item._baileys_source_id,
      source_url: item._baileys_source_url,
      thumbnail_url: item._baileys_thumbnail_url,
      headline: item._baileys_headline,
      ad_body: item._baileys_ad_body,
    },
    item,
  ]);
  const ctwa_clid = referral?.ctwa_clid || null;
  let source_id = referral?.source_id || null;
  const source_url = referral?.source_url || null;
  const thumbnail_url = referral?.thumbnail_url || null;
  const media_url = referral?.media_url || null;
  const headline = referral?.headline || null;
  const ad_body = referral?.ad_body || null;

  // A tag is an ad reference only; it must not be paired with another context's click.
  if (!referral && conversation) {
    const tagMatch =
      conversation.match(
        /\[(?:AD|REF|COD|ANUNCIO|ID|ANÚNCIO)[:\s-]*(\d{6,})\]/i,
      ) ||
      conversation.match(/(?:AD|REF|COD|ANUNCIO|ANÚNCIO)[:\s-]+(\d{6,})/i) ||
      conversation.match(/(?:hsa_ad|ad_id)=(\d{6,})/i);
    if (tagMatch) source_id = tagMatch[1];
  }

  return {
    ok: true,
    lead: {
      name,
      phone,
      ctwa_clid,
      source_id,
      source_url,
      thumbnail_url,
      media_url,
      headline,
      ad_body,
      message_text: conversation,
      instance,
      fromMe,
      message_id:
        typeof key.id === "string"
          ? key.id
          : typeof item.id === "string"
            ? item.id
            : null,
      received_at: whatsappTimestamp(item.messageTimestamp || item.timestamp),
      type: messageType,
      mimetype:
        typeof attachment.mimetype === "string" ? attachment.mimetype : null,
      message_media_url:
        typeof item.mediaUrl === "string" ? item.mediaUrl : null,
      base64: typeof item.base64 === "string" ? item.base64 : null,
      filename:
        typeof attachment.fileName === "string" ? attachment.fileName : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Cliente Evolution API (Gerenciamento de Instância e QR Code)
// ---------------------------------------------------------------------------

export interface EvolutionConfig {
  serverUrl: string;
  apiKey: string;
  instanceName: string;
}

export function normalizeBaseUrl(url: string): string {
  let u = (url || "").trim().replace(/\/+$/, "");
  if (!u) return "http://localhost:8080";
  if (!/^https?:\/\//i.test(u)) {
    u = `http://${u}`;
  }
  return u;
}

export async function safeFetchJson<T = any>(
  url: string,
  options: RequestInit = {},
): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  let res: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    res = await fetch(url, {
      ...options,
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err || "");
    if (msg.includes("abort") || err.name === "AbortError") {
      return {
        ok: false,
        status: 408,
        data: null,
        error: `Tempo limite esgotado ao conectar a ${url} (12s). Verifique se o servidor está ativo e a porta aberta no firewall.`,
      };
    }
    if (
      msg.includes("fetch failed") ||
      msg.includes("ECONNREFUSED") ||
      msg.includes("ENOTFOUND")
    ) {
      return {
        ok: false,
        status: 503,
        data: null,
        error: `Não foi possível conectar ao servidor (${url}). Verifique se a Evolution API está em execução no endereço e porta informados.`,
      };
    }
    return {
      ok: false,
      status: 500,
      data: null,
      error: `Erro de conexão: ${msg}`,
    };
  }

  const rawText = await res.text();
  let data: T | null = null;
  try {
    data = JSON.parse(rawText) as T;
  } catch {
    const isHtml =
      rawText.includes("<!DOCTYPE") ||
      rawText.includes("<html") ||
      rawText.includes("<body") ||
      rawText.includes("<head");
    if (isHtml) {
      if (res.status === 404) {
        return {
          ok: false,
          status: 404,
          data: null,
          error: `O endereço '${url}' retornou erro 404 (Página não encontrada). Verifique se a URL e a porta da Evolution API estão corretas.`,
        };
      }
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        return {
          ok: false,
          status: res.status,
          data: null,
          error: `O servidor proxy retornou erro ${res.status} ao acessar '${url}'. A Evolution API pode estar desligada ou reiniciando.`,
        };
      }
      return {
        ok: false,
        status: res.status,
        data: null,
        error: `O endereço '${url}' retornou uma página HTML (Status ${res.status}) em vez de JSON da Evolution API. Verifique se o endereço está correto (ex: http://seu-ip:8080 ou https://evolution.seudominio.com).`,
      };
    }
    return {
      ok: false,
      status: res.status,
      data: null,
      error: `Resposta inesperada (não JSON): ${rawText.slice(0, 150)}`,
    };
  }

  const jsonError =
    (data as any)?.message ||
    (data as any)?.error ||
    (data as any)?.response?.message ||
    (res.ok ? undefined : `Erro HTTP ${res.status}`);

  return {
    ok: res.ok,
    status: res.status,
    data,
    error: jsonError,
  };
}

export async function evolutionGetState(config: EvolutionConfig): Promise<{
  ok: boolean;
  state: "open" | "connecting" | "close" | "not_found";
  phone?: string | null;
  error?: string;
}> {
  const base = normalizeBaseUrl(config.serverUrl);
  const targetUrl = `${base}/instance/connectionState/${encodeURIComponent(config.instanceName)}`;
  const res = await safeFetchJson(targetUrl, {
    headers: { apikey: config.apiKey },
  });

  if (!res.ok) {
    if (
      res.status === 404 ||
      res.error?.includes("not found") ||
      res.error?.includes("não encontrada") ||
      (res.data as any)?.response?.message?.includes("not found")
    ) {
      return { ok: true, state: "not_found" };
    }
    return { ok: false, state: "close", error: res.error };
  }

  const json = res.data as any;
  const state = json?.instance?.state || json?.state || "close";
  const phone = json?.instance?.ownerJid || json?.ownerJid || null;
  return {
    ok: true,
    state,
    phone: phone ? String(phone).replace(/\D/g, "") : null,
  };
}

export async function evolutionSetWebhook(
  config: EvolutionConfig,
  webhookUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  const base = normalizeBaseUrl(config.serverUrl);
  const res = await safeFetchJson(
    `${base}/webhook/set/${encodeURIComponent(config.instanceName)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: config.apiKey,
      },
      body: JSON.stringify({
        enabled: true,
        url: webhookUrl,
        webhookByEvents: false,
        events: ["MESSAGES_UPSERT"],
      }),
    },
  );
  return { ok: res.ok, error: res.error };
}

export async function evolutionCreateOrConnect(
  config: EvolutionConfig,
  webhookUrl?: string,
): Promise<{
  ok: boolean;
  state: "open" | "connecting" | "close";
  qrcode: string | null;
  phone?: string | null;
  error?: string;
}> {
  const base = normalizeBaseUrl(config.serverUrl);

  // 1. Verifica estado atual
  const current = await evolutionGetState(config);
  if (current.ok && current.state === "open") {
    if (webhookUrl) await evolutionSetWebhook(config, webhookUrl);
    return { ok: true, state: "open", qrcode: null, phone: current.phone };
  }

  if (!current.ok && current.state !== "not_found") {
    return {
      ok: false,
      state: "close",
      qrcode: null,
      error:
        current.error ||
        "Não foi possível verificar a instância da Evolution API.",
    };
  }

  // 2. Se a instância não existe, cria
  if (current.state === "not_found") {
    const createRes = await safeFetchJson(`${base}/instance/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: config.apiKey,
      },
      body: JSON.stringify({
        instanceName: config.instanceName,
        qrcode: true,
        integration: "WHATSAPP-BAILEYS",
      }),
    });

    if (!createRes.ok) {
      return {
        ok: false,
        state: "close",
        qrcode: null,
        error: createRes.error,
      };
    }

    if (webhookUrl) await evolutionSetWebhook(config, webhookUrl);
    const json = createRes.data as any;
    const qr = json?.qrcode?.base64 || json?.base64 || json?.code || null;
    return { ok: true, state: "connecting", qrcode: qr };
  }

  // 3. Se já existe mas está desconectada, chama connect para obter novo QR Code
  const connRes = await safeFetchJson(
    `${base}/instance/connect/${encodeURIComponent(config.instanceName)}`,
    {
      headers: { apikey: config.apiKey },
    },
  );

  if (!connRes.ok) {
    return { ok: false, state: "close", qrcode: null, error: connRes.error };
  }

  if (webhookUrl) await evolutionSetWebhook(config, webhookUrl);
  const json = connRes.data as any;
  const qr = json?.base64 || json?.qrcode?.base64 || json?.code || null;
  return { ok: true, state: "connecting", qrcode: qr };
}

export async function evolutionLogout(
  config: EvolutionConfig,
): Promise<{ ok: boolean; error?: string }> {
  const base = normalizeBaseUrl(config.serverUrl);
  const res = await safeFetchJson(
    `${base}/instance/logout/${encodeURIComponent(config.instanceName)}`,
    {
      method: "DELETE",
      headers: { apikey: config.apiKey },
    },
  );
  return { ok: res.ok, error: res.error };
}

export async function evolutionSendMessage(
  config: EvolutionConfig,
  phone: string,
  text: string,
): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  const base = normalizeBaseUrl(config.serverUrl);
  const cleanPhone = phone.replace(/\D/g, "");
  const res = await safeFetchJson(
    `${base}/message/sendText/${encodeURIComponent(config.instanceName)}`,
    {
      method: "POST",
      headers: {
        apikey: config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        number: cleanPhone,
        text,
      }),
    },
  );
  if (!res.ok) {
    return {
      ok: false,
      error: res.error || "Erro ao enviar mensagem pela Evolution API.",
    };
  }
  return { ok: true, messageId: sentMessageId(res.data) };
}

export async function evolutionSendMedia(
  config: EvolutionConfig,
  phone: string,
  media: {
    base64: string;
    mimetype: string;
    filename?: string;
    caption?: string;
  },
): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  const number = normalizePhone(phone);
  if (!number) return { ok: false, error: "Telefone inválido." };
  const base64 = media.base64.replace(/^data:.*?;base64,/, "");
  if (!base64 || Buffer.byteLength(base64, "base64") > 8 * 1024 * 1024)
    return { ok: false, error: "Envie um arquivo de até 8 MB." };
  const audio = media.mimetype.startsWith("audio/");
  const response = await safeFetchJson(
    `${normalizeBaseUrl(config.serverUrl)}/message/${audio ? "sendWhatsAppAudio" : "sendMedia"}/${encodeURIComponent(config.instanceName)}`,
    {
      method: "POST",
      headers: { apikey: config.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(
        audio
          ? { number, audio: base64 }
          : {
              number,
              mediatype: media.mimetype.startsWith("image/")
                ? "image"
                : media.mimetype.startsWith("video/")
                  ? "video"
                  : "document",
              mimetype: media.mimetype,
              caption: media.caption || "",
              media: base64,
              fileName: media.filename || "arquivo",
            },
      ),
    },
  );
  return {
    ok: response.ok,
    error: response.error,
    messageId: sentMessageId(response.data),
  };
}

function sentMessageId(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const row = data as Record<string, unknown>;
  const key =
    row.key && typeof row.key === "object"
      ? (row.key as Record<string, unknown>)
      : {};
  return typeof key.id === "string"
    ? key.id
    : typeof row.id === "string"
      ? row.id
      : undefined;
}
