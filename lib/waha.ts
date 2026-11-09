import { selectReferralGroups } from "./ctwa";
import { normalizePhone } from "./normalize";
import type { ParsedEvolutionLead } from "./evolution";
import { phoneFromWhatsAppJid, whatsappTimestamp } from "./evolution";

/**
 * Parser de Webhook do WAHA (WhatsApp HTTP API - devlikeapro/waha).
 * Suporta engines WEBJS (Puppeteer) e NOWEB (Baileys).
 *
 * Ao receber a mensagem de lead Click-to-WhatsApp via WAHA:
 * 1. Extrai o telefone do remetente (payload.from)
 * 2. Extrai ctwa_clid (campos explícitos ctwaClid/ctwa_clid do provedor)
 * 3. Extrai dados do anúncio (externalAdReply ou tags no texto como [AD:123456])
 */
export function parseWahaWebhook(
  body: Record<string, unknown>,
):
  | { ok: true; lead: ParsedEvolutionLead }
  | { ok: false; ignored?: boolean; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Payload vazio ou inválido." };
  }

  // WAHA envia o evento no campo 'event' (ex: 'message', 'message.any')
  const event = String(body.event || "");
  if (event && !event.startsWith("message")) {
    return {
      ok: false,
      ignored: true,
      error: `Evento WAHA "${event}" ignorado.`,
    };
  }

  const session = typeof body.session === "string" ? body.session : "default";

  // Objeto principal de mensagem no WAHA fica em body.payload
  const payload = (body.payload || body) as Record<string, unknown>;

  const fromMe = Boolean(payload.fromMe);
  if (fromMe) {
    return {
      ok: false,
      ignored: true,
      error: "Mensagem enviada pelo próprio número (fromMe: true).",
    };
  }

  const rawFrom = String(payload.from || payload.author || "");
  if (!rawFrom) {
    return {
      ok: false,
      error: "Nenhum remetente ('from') encontrado no payload do WAHA.",
    };
  }

  // Ignora grupos e transmissões/status
  if (rawFrom.includes("@g.us") || rawFrom.includes("@broadcast")) {
    return {
      ok: false,
      ignored: true,
      error: "Mensagem de grupo ou broadcast ignorada.",
    };
  }

  const phone = phoneFromWhatsAppJid(
    rawFrom,
    payload.fromAlt || payload.senderPn,
  );
  if (!phone) {
    if (rawFrom.endsWith("@lid"))
      return {
        ok: false,
        ignored: true,
        error: "Identificador LID sem telefone resolvido.",
      };
    return {
      ok: false,
      error: `Telefone inválido extraído do remetente: ${rawFrom}`,
    };
  }

  const data = (payload._data || {}) as Record<string, unknown>;

  // Nome do contato
  const name =
    typeof payload.notifyName === "string" && payload.notifyName.trim()
      ? payload.notifyName.trim()
      : typeof data.notifyName === "string" && data.notifyName.trim()
        ? data.notifyName.trim()
        : typeof payload.pushName === "string" && payload.pushName.trim()
          ? payload.pushName.trim()
          : null;

  // Texto da mensagem
  const messageText =
    typeof payload.body === "string" && payload.body.trim()
      ? payload.body.trim()
      : typeof data.body === "string" && data.body.trim()
        ? data.body.trim()
        : null;

  // Select one complete provider context before extracting its reference.
  const referral = selectReferralGroups([
    data.contextInfo,
    payload.contextInfo,
    data,
    payload,
  ]);
  const ctwa_clid = referral?.ctwa_clid || null;
  let source_id = referral?.source_id || null;
  const source_url = referral?.source_url || null;
  const thumbnail_url = referral?.thumbnail_url || null;
  const media_url = referral?.media_url || null;
  const headline = referral?.headline || null;
  const ad_body = referral?.ad_body || null;

  // Text tags identify an ad only when no separate referral context is present.
  if (!referral && messageText) {
    const tagMatch =
      messageText.match(
        /\[(?:AD|REF|COD|ANUNCIO|ID|ANÚNCIO)[:\s-]*(\d{6,})\]/i,
      ) ||
      messageText.match(/(?:AD|REF|COD|ANUNCIO|ANÚNCIO)[:\s-]+(\d{6,})/i) ||
      messageText.match(/(?:hsa_ad|ad_id)=(\d{6,})/i);
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
      message_text: messageText,
      instance: session,
      fromMe: false,
      message_id:
        typeof payload.id === "string"
          ? payload.id
          : typeof data.id === "string"
            ? data.id
            : null,
      received_at: whatsappTimestamp(payload.timestamp || data.t),
      type:
        String(payload.type || data.type || "text").includes("audio") ||
        payload.type === "ptt"
          ? "audio"
          : payload.type === "image"
            ? "image"
            : payload.type === "video"
              ? "video"
              : payload.type === "document"
                ? "document"
                : "text",
      mimetype:
        typeof (payload.media as Record<string, unknown> | undefined)
          ?.mimetype === "string"
          ? String((payload.media as Record<string, unknown>).mimetype)
          : typeof data.mimetype === "string"
            ? data.mimetype
            : null,
      message_media_url:
        typeof (payload.media as Record<string, unknown> | undefined)?.url ===
        "string"
          ? String((payload.media as Record<string, unknown>).url)
          : null,
      base64: typeof payload.base64 === "string" ? payload.base64 : null,
      filename: typeof data.filename === "string" ? data.filename : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Cliente WAHA (Gerenciamento de Sessão e QR Code via HTTP REST)
// ---------------------------------------------------------------------------

export interface WahaConfig {
  serverUrl: string;
  apiKey?: string;
  sessionName: string;
}
export function normalizeWahaUrl(value: string): string {
  const url = new URL(value.trim());
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Use o endereço HTTP/HTTPS do WAHA na VPS, sem senha ou parâmetros na URL.",
    );
  return url
    .toString()
    .replace(/\/+$/, "")
    .replace(/\/api$/, "");
}
function wahaHeaders(
  apiKey?: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    ...extra,
    ...(apiKey?.trim() ? { "X-Api-Key": apiKey.trim() } : {}),
  };
}
function wahaError(status: number, data: unknown, key?: string): string {
  const row =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const detail = (
    Array.isArray(row.message)
      ? row.message.join(" ")
      : String(row.message || row.error || "")
  ).slice(0, 600);
  const safe = key ? detail.replaceAll(key, "[chave ocultada]") : detail;
  if (status === 401 || status === 403)
    return "O WAHA recusou a chave de acesso. Use a WAHA_API_KEY da instalação na VPS (não a senha do dashboard). Confira também as permissões da chave.";
  if (status === 502 || status === 503 || status === 504)
    return "A VPS ou o proxy não conseguiu responder pelo WAHA. Confira o contêiner, a porta interna e a rota HTTPS.";
  if (/only.*default|core.*session|multiple.*session/i.test(safe))
    return "WAHA Core aceita apenas a sessão default. Use default ou uma edição que suporte múltiplas sessões.";
  return `WAHA respondeu HTTP ${status}.${safe ? " " + safe : " Confira o endereço do serviço e sua versão."}`;
}
async function wahaRequest(
  config: WahaConfig,
  path: string,
  options: RequestInit = {},
) {
  try {
    const base = normalizeWahaUrl(config.serverUrl);
    const response = await fetch(base + path, {
      ...options,
      headers: {
        ...wahaHeaders(config.apiKey, { Accept: "application/json" }),
        ...options.headers,
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    let data: Record<string, unknown> | null = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      return {
        ok: false,
        status: response.status,
        data: null,
        error:
          "O endereço retornou uma página HTML ou resposta inválida. Informe a URL da API do WAHA na VPS, não o painel do provedor ou o endereço do Track Manual.",
      };
    }
    if (!response.ok)
      return {
        ok: false,
        status: response.status,
        data,
        error: wahaError(response.status, data, config.apiKey),
      };
    return { ok: true, status: response.status, data, error: undefined };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error:
        error instanceof Error &&
        /invalid url|endereço HTTP/i.test(error.message)
          ? "Informe o endereço HTTP/HTTPS correto do WAHA na VPS."
          : "Não foi possível acessar o WAHA. Confira DNS, HTTPS, contêiner e porta na VPS. localhost aponta para o servidor do Track Manual, não para sua VPS. A consulta tem limite de 10 segundos.",
    };
  }
}
export async function wahaGetState(
  config: WahaConfig,
): Promise<{
  ok: boolean;
  state: "open" | "connecting" | "close" | "not_found";
  phone?: string | null;
  error?: string;
  providerStatus?: string;
  configuration?: Record<string, unknown>;
}> {
  const res = await wahaRequest(
    config,
    `/api/sessions/${encodeURIComponent(config.sessionName || "default")}`,
  );
  if (!res.ok) {
    if (
      res.status === 404 &&
      res.data &&
      !/cannot (get|post)|route.*not found/i.test(
        String(res.data.message || ""),
      )
    )
      return { ok: true, state: "not_found", providerStatus: "NOT_FOUND" };
    return { ok: false, state: "close", error: res.error };
  }
  const data = res.data || {};
  const status = String(data.status || "").toUpperCase();
  const configuration =
    data.config && typeof data.config === "object"
      ? (data.config as Record<string, unknown>)
      : {};
  if (status === "WORKING") {
    const me = (data.me || data.user || {}) as Record<string, unknown>;
    return {
      ok: true,
      state: "open",
      phone: phoneFromWhatsAppJid(me.id) || null,
      providerStatus: status,
      configuration,
    };
  }
  if (["STARTING", "SCAN_QR_CODE"].includes(status))
    return {
      ok: true,
      state: "connecting",
      providerStatus: status,
      configuration,
    };
  if (["STOPPED", "FAILED"].includes(status))
    return {
      ok: true,
      state: "close",
      providerStatus: status,
      configuration,
      error:
        status === "FAILED"
          ? "A sessão WAHA falhou ou o QR expirou. Clique em Salvar e conectar para reiniciar a sessão."
          : undefined,
    };
  return {
    ok: false,
    state: "close",
    providerStatus: status,
    error:
      status === "PASSKEY_REQUIRED"
        ? "O WhatsApp solicitou uma passkey. Conclua a autenticação pelo dashboard do WAHA."
        : "O serviço não retornou um estado WAHA reconhecido. Confira a URL e a versão instalada.",
  };
}
export async function wahaQr(
  config: WahaConfig,
): Promise<{ qrcode: string | null; error?: string }> {
  try {
    const response = await fetch(
      `${normalizeWahaUrl(config.serverUrl)}/api/${encodeURIComponent(config.sessionName || "default")}/auth/qr?format=image`,
      {
        headers: wahaHeaders(config.apiKey, { Accept: "application/json" }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      if ([404, 422].includes(response.status)) return { qrcode: null };
      return {
        qrcode: null,
        error: wahaError(
          response.status,
          await response.json().catch(() => null),
          config.apiKey,
        ),
      };
    }
    const type = (response.headers.get("content-type") || "").split(";")[0];
    if (["image/png", "image/jpeg", "image/webp"].includes(type)) {
      const data = Buffer.from(await response.arrayBuffer());
      return data.length <= 2_000_000
        ? { qrcode: `data:${type};base64,${data.toString("base64")}` }
        : {
            qrcode: null,
            error: "Imagem QR recebida excede o limite permitido.",
          };
    }
    const json = (await response.json()) as Record<string, unknown>;
    const mime = String(json.mimetype || "image/png");
    if (
      typeof json.data === "string" &&
      ["image/png", "image/jpeg", "image/webp"].includes(mime) &&
      /^[A-Za-z0-9+/=\r\n]+$/.test(json.data) &&
      json.data.length < 2_700_000
    )
      return { qrcode: `data:${mime};base64,${json.data.replace(/\s/g, "")}` };
    const candidate = json.value || json.raw || json.qr || json.image;
    if (
      typeof candidate === "string" &&
      /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(candidate) &&
      candidate.length < 2_700_000
    )
      return { qrcode: candidate };
    if (
      typeof candidate === "string" &&
      candidate.length > 0 &&
      candidate.length < 20_000 &&
      !/^https?:|^data:|^</i.test(candidate)
    ) {
      const QRCode = await import("qrcode");
      return {
        qrcode: await QRCode.toDataURL(candidate, { width: 360, margin: 2 }),
      };
    }
    return {
      qrcode: null,
      error:
        "O WAHA não devolveu uma imagem QR válida. Confira a sessão e o estado SCAN_QR_CODE.",
    };
  } catch {
    return {
      qrcode: null,
      error:
        "Não foi possível buscar o QR no WAHA. Confira o acesso ao serviço na VPS.",
    };
  }
}
export async function wahaGetQrCode(
  config: WahaConfig,
): Promise<string | null> {
  return (await wahaQr(config)).qrcode;
}
export async function wahaCreateOrConnect(
  config: WahaConfig,
  webhookUrl?: string,
): Promise<{
  ok: boolean;
  state: "open" | "connecting" | "close";
  qrcode: string | null;
  phone?: string | null;
  error?: string;
  providerStatus?: string;
}> {
  const session = encodeURIComponent(config.sessionName || "default");
  const current = await wahaGetState(config);
  if (!current.ok) return { ...current, state: "close", qrcode: null };
  if (current.state === "not_found") {
    const created = await wahaRequest(config, "/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: config.sessionName || "default",
        start: true,
        config: webhookUrl
          ? { webhooks: [{ url: webhookUrl, events: ["message"] }] }
          : {},
      }),
    });
    if (!created.ok)
      return { ok: false, state: "close", qrcode: null, error: created.error };
  } else {
    if (webhookUrl) {
      const previous = current.configuration || {};
      const webhooks = Array.isArray(previous.webhooks)
        ? previous.webhooks.filter(
            (item) =>
              item &&
              typeof item === "object" &&
              (item as Record<string, unknown>).url !== webhookUrl &&
              !String((item as Record<string, unknown>).url || "").includes(
                "/api/webhook/waha/",
              ),
          )
        : [];
      const updated = await wahaRequest(config, `/api/sessions/${session}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: config.sessionName || "default",
          config: {
            ...previous,
            webhooks: [...webhooks, { url: webhookUrl, events: ["message"] }],
          },
        }),
      });
      if (!updated.ok)
        return {
          ok: false,
          state: current.state === "open" ? "open" : "close",
          qrcode: null,
          phone: current.phone,
          error: updated.error,
        };
    }
    if (current.state === "close") {
      const start = await wahaRequest(
        config,
        `/api/sessions/${session}/${current.providerStatus === "FAILED" ? "restart" : "start"}`,
        { method: "POST" },
      );
      if (!start.ok)
        return { ok: false, state: "close", qrcode: null, error: start.error };
    }
  }
  const state = await wahaGetState(config);
  if (!state.ok) return { ...state, state: "close", qrcode: null };
  if (state.state === "open")
    return {
      ok: true,
      state: "open",
      qrcode: null,
      phone: state.phone,
      providerStatus: state.providerStatus,
    };
  if (state.state !== "connecting")
    return {
      ok: false,
      state: "close",
      qrcode: null,
      error:
        state.error ||
        "O WAHA não iniciou a sessão. Confira os logs do contêiner.",
    };
  const qr =
    state.providerStatus === "SCAN_QR_CODE"
      ? await wahaQr(config)
      : { qrcode: null };
  return {
    ok: !qr.error,
    state: "connecting",
    ...qr,
    providerStatus: state.providerStatus,
  };
}
export async function wahaLogout(
  config: WahaConfig,
): Promise<{ ok: boolean; error?: string }> {
  const result = await wahaRequest(
    config,
    `/api/sessions/${encodeURIComponent(config.sessionName || "default")}/logout`,
    { method: "POST" },
  );
  return { ok: result.ok, error: result.error };
}

export async function wahaSendMessage(
  config: WahaConfig,
  phone: string,
  text: string,
): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  const session = config.sessionName || "default";
  const cleanPhone = phone.replace(/\D/g, "");
  const chatId = `${cleanPhone}@c.us`;

  const res = await wahaRequest(config, `/api/sendText`, {
    method: "POST",
    headers: wahaHeaders(config.apiKey, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      session,
      chatId,
      text,
    }),
  });

  if (!res.ok) {
    return {
      ok: false,
      error: res.error || "Erro ao enviar mensagem pelo WAHA.",
    };
  }
  return { ok: true, messageId: sentMessageId(res.data) };
}

export async function wahaSendMedia(
  config: WahaConfig,
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
  const data = media.base64.replace(/^data:.*?;base64,/, "");
  if (!data || Buffer.byteLength(data, "base64") > 8 * 1024 * 1024)
    return { ok: false, error: "Envie um arquivo de até 8 MB." };
  const endpoint = media.mimetype.startsWith("image/")
    ? "sendImage"
    : media.mimetype.startsWith("audio/")
      ? "sendVoice"
      : media.mimetype.startsWith("video/")
        ? "sendVideo"
        : "sendFile";
  const response = await wahaRequest(config, `/api/${endpoint}`, {
    method: "POST",
    headers: wahaHeaders(config.apiKey, {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      session: config.sessionName || "default",
      chatId: `${number}@c.us`,
      caption: media.caption || "",
      file: {
        mimetype: media.mimetype,
        filename: media.filename || "arquivo",
        data,
      },
    }),
  });
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
