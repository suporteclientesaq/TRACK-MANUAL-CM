import { selectReferralGroups } from "./ctwa";
import { normalizePhone } from "./normalize";
import type { ParsedEvolutionLead } from "./evolution";
import {
  normalizeBaseUrl,
  safeFetchJson,
  phoneFromWhatsAppJid,
  whatsappTimestamp,
} from "./evolution";

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
  const data = (payload._data || {}) as Record<string, unknown>;

  const fromMe = Boolean(payload.fromMe);
  const rawRecipient = fromMe
    ? String(payload.to || payload.chatId || data.to || "")
    : String(payload.from || payload.author || "");

  if (!rawRecipient) {
    return {
      ok: false,
      error: fromMe
        ? "Nenhum destinatário ('to') encontrado no payload do WAHA."
        : "Nenhum remetente ('from') encontrado no payload do WAHA.",
    };
  }

  // Ignora grupos e transmissões/status
  if (
    rawRecipient.includes("@g.us") ||
    rawRecipient.includes("@broadcast") ||
    rawRecipient.includes("status@broadcast") ||
    rawRecipient.includes("newsletter")
  ) {
    return {
      ok: false,
      ignored: true,
      error: "Mensagem de grupo ou broadcast ignorada.",
    };
  }

  const phone = phoneFromWhatsAppJid(
    rawRecipient,
    fromMe ? undefined : (payload.fromAlt || payload.senderPn),
  );
  if (!phone) {
    if (rawRecipient.endsWith("@lid"))
      return {
        ok: false,
        ignored: true,
        error: "Identificador LID sem telefone resolvido.",
      };
    return {
      ok: false,
      error: `Telefone inválido extraído: ${rawRecipient}`,
    };
  }

  // Nome do contato: se fromMe for true, não usamos o nome do atendente/empresa
  let name: string | null = null;
  if (!fromMe) {
    const sender = (payload.sender || {}) as Record<string, unknown>;
    const contact = (payload.contact || {}) as Record<string, unknown>;
    const chat = (payload.chat || {}) as Record<string, unknown>;
    const candidateNames = [
      payload.notifyName,
      data.notifyName,
      payload.pushName,
      data.pushName,
      sender.pushName,
      sender.name,
      contact.name,
      contact.pushname,
      data.verifiedName,
      payload.verifiedName,
      chat.name,
    ];
    for (const c of candidateNames) {
      if (typeof c === "string" && c.trim() && c.trim() !== "Sem Nome") {
        const clean = c.trim();
        if (!/^(continental\s*studio|atendimento|suporte)$/i.test(clean)) {
          name = clean;
          break;
        }
      }
    }
  }

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

function wahaHeaders(
  apiKey?: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const key = (apiKey || "").trim();
  if (key) {
    headers["X-Api-Key"] = key;
    headers["apikey"] = key;
    headers["Authorization"] = `Bearer ${key}`;
  }
  return headers;
}

export async function wahaGetState(config: WahaConfig): Promise<{
  ok: boolean;
  state: "open" | "connecting" | "close" | "not_found";
  phone?: string | null;
  error?: string;
}> {
  const base = normalizeBaseUrl(config.serverUrl);
  const session = config.sessionName || "default";
  const res = await safeFetchJson(
    `${base}/api/sessions/${encodeURIComponent(session)}`,
    {
      headers: wahaHeaders(config.apiKey),
    },
  );

  if (!res.ok) {
    if (
      res.status === 404 ||
      res.error?.includes("not found") ||
      res.error?.includes("não encontrada") ||
      (res.data as any)?.message?.includes("not found")
    ) {
      return { ok: true, state: "not_found" };
    }
    return { ok: false, state: "close", error: res.error };
  }

  const data = res.data as any;
  const status = String(data?.status || "").toUpperCase();

  if (status === "WORKING") {
    const rawId = data?.me?.id || data?.user?.id || "";
    const phone = String(rawId).replace(/\D/g, "");
    return { ok: true, state: "open", phone: phone || null };
  }
  if (status === "SCAN_QR_CODE" || status === "STARTING") {
    return { ok: true, state: "connecting" };
  }
  return { ok: true, state: "close" };
}

export async function wahaGetQrCode(
  config: WahaConfig,
): Promise<string | null> {
  const base = normalizeBaseUrl(config.serverUrl);
  const session = config.sessionName || "default";

  try {
    const targetUrl = `${base}/api/${encodeURIComponent(session)}/auth/qr`;
    const res = await fetch(targetUrl, {
      headers: wahaHeaders(config.apiKey, {
        Accept: "application/json, image/png, */*",
      }),
      cache: "no-store",
    });

    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("image/")) {
      const buffer = await res.arrayBuffer();
      const b64 = Buffer.from(buffer).toString("base64");
      return `data:${contentType};base64,${b64}`;
    }

    const text = await res.text();
    try {
      const json = JSON.parse(text);
      if (json?.image) return json.image;
      if (json?.raw) return json.raw;
      if (json?.qr) return json.qr;
    } catch {
      // Se retornou string base64 pura
      if (text.startsWith("data:image/") || text.length > 100) {
        return text.trim();
      }
    }
    return null;
  } catch {
    return null;
  }
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
}> {
  const base = normalizeBaseUrl(config.serverUrl);
  const session = config.sessionName || "default";

  // 1. Verifica estado atual
  const current = await wahaGetState(config);
  if (current.ok && current.state === "open") {
    if (webhookUrl) {
      const webhook = await safeFetchJson(
        `${base}/api/sessions/${encodeURIComponent(session)}`,
        {
          method: "PATCH",
          headers: wahaHeaders(config.apiKey, {
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({
            config: { webhooks: [{ url: webhookUrl, events: ["message"] }] },
          }),
        },
      );
      if (!webhook.ok)
        return {
          ok: false,
          state: "open",
          qrcode: null,
          phone: current.phone,
          error:
            webhook.error ||
            "A sessão está conectada, mas não foi possível atualizar o webhook.",
        };
    }
    return { ok: true, state: "open", qrcode: null, phone: current.phone };
  }

  // 2. Se a sessão não existe, cria / inicia
  if (current.state === "not_found") {
    const startBody: any = {
      name: session,
      start: true,
      config: {},
    };
    if (webhookUrl) {
      startBody.config.webhooks = [
        {
          url: webhookUrl,
          events: ["message"],
        },
      ];
    }

    const createRes = await safeFetchJson(`${base}/api/sessions`, {
      method: "POST",
      headers: wahaHeaders(config.apiKey, {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(startBody),
    });

    if (!createRes.ok) {
      // Tenta rota alternativa POST /api/sessions/start
      const altRes = await safeFetchJson(`${base}/api/sessions/start`, {
        method: "POST",
        headers: wahaHeaders(config.apiKey, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(startBody),
      });
      if (!altRes.ok) {
        return {
          ok: false,
          state: "close",
          qrcode: null,
          error:
            createRes.error ||
            altRes.error ||
            "Não foi possível criar a sessão no WAHA.",
        };
      }
    }
  } else if (current.state === "close") {
    // Inicia sessão existente
    await safeFetchJson(
      `${base}/api/sessions/${encodeURIComponent(session)}/start`,
      {
        method: "POST",
        headers: wahaHeaders(config.apiKey, {
          "Content-Type": "application/json",
        }),
      },
    );
  }

  // Se tem webhook e a sessão já existia, atualiza se suportado
  if (webhookUrl && current.state !== "not_found") {
    await safeFetchJson(`${base}/api/sessions/${encodeURIComponent(session)}`, {
      method: "PATCH",
      headers: wahaHeaders(config.apiKey, {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        config: {
          webhooks: [{ url: webhookUrl, events: ["message"] }],
        },
      }),
    });
  }

  // Aguarda 1.2s para geração do QR Code pelo WAHA
  await new Promise((r) => setTimeout(r, 1200));

  // 3. Busca QR Code
  const qr = await wahaGetQrCode(config);
  return { ok: true, state: "connecting", qrcode: qr };
}

export async function wahaLogout(
  config: WahaConfig,
): Promise<{ ok: boolean; error?: string }> {
  const base = normalizeBaseUrl(config.serverUrl);
  const session = config.sessionName || "default";

  const res = await safeFetchJson(
    `${base}/api/sessions/${encodeURIComponent(session)}/logout`,
    {
      method: "POST",
      headers: wahaHeaders(config.apiKey),
    },
  );

  if (!res.ok) {
    // Tenta /stop
    const stopRes = await safeFetchJson(
      `${base}/api/sessions/${encodeURIComponent(session)}/stop`,
      {
        method: "POST",
        headers: wahaHeaders(config.apiKey),
      },
    );
    return { ok: stopRes.ok, error: stopRes.error };
  }

  return { ok: true };
}

export async function wahaSendMessage(
  config: WahaConfig,
  phone: string,
  text: string,
): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  const base = normalizeBaseUrl(config.serverUrl);
  const session = config.sessionName || "default";
  const cleanPhone = phone.replace(/\D/g, "");
  const chatId = `${cleanPhone}@c.us`;

  const res = await safeFetchJson(`${base}/api/sendText`, {
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
  const response = await safeFetchJson(
    `${normalizeBaseUrl(config.serverUrl)}/api/${endpoint}`,
    {
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

/**
 * Sincroniza em tempo real as conversas, mensagens e avatares do WhatsApp diretamente via API do WAHA.
 * Puxa todos os chats ativos estilo WhatsApp Web.
 */
export async function wahaSyncLiveChats(
  config: WahaConfig,
  clientId: string,
): Promise<{ ok: boolean; syncedCount: number; error?: string }> {
  const base = normalizeBaseUrl(config.serverUrl);
  const session = config.sessionName || "default";

  try {
    let chatsRes = await safeFetchJson<any[]>(
      `${base}/api/${encodeURIComponent(session)}/chats`,
      { headers: wahaHeaders(config.apiKey) },
    );
    if (!chatsRes.ok || !Array.isArray(chatsRes.data)) {
      chatsRes = await safeFetchJson<any[]>(
        `${base}/api/chats?session=${encodeURIComponent(session)}`,
        { headers: wahaHeaders(config.apiKey) },
      );
    }

    if (!chatsRes.ok || !Array.isArray(chatsRes.data) || chatsRes.data.length === 0) {
      return {
        ok: false,
        syncedCount: 0,
        error: chatsRes.error || "Nenhum chat retornado pelo WAHA.",
      };
    }

    const { ingestLead } = await import("./ingest");
    let synced = 0;

    for (const chat of chatsRes.data) {
      const chatId = String(chat.id || "");
      if (
        chatId.includes("@g.us") ||
        chatId.includes("@broadcast") ||
        chatId.includes("newsletter")
      )
        continue;

      const rawPhone = chatId.replace(/@.*$/, "").split(":")[0].replace(/\D/g, "");
      const phone = normalizePhone(rawPhone);
      if (!phone) continue;

      let chatName =
        typeof chat.name === "string" && chat.name.trim() ? chat.name.trim() : null;
      if (chatName && (/continental\s*studio/i.test(chatName) || chatName.length < 2)) {
        chatName = null;
      }

      const picture =
        typeof chat.picture === "string" && chat.picture.startsWith("http")
          ? chat.picture
          : null;
      const lastMsg = (chat.lastMessage || {}) as Record<string, unknown>;
      const msgText =
        typeof lastMsg.body === "string" && lastMsg.body.trim()
          ? lastMsg.body.trim()
          : null;
      const timestamp = Number(lastMsg.timestamp || 0) * 1000 || Date.now();
      const fromMe = Boolean(lastMsg.fromMe);

      await ingestLead(
        clientId,
        {
          name: chatName,
          phone,
          thumbnail_url: picture,
        },
        "manual",
        {
          origin: "waha",
          received_at: new Date(timestamp).toISOString(),
          instance: session,
          message_text: msgText,
          fromMe,
          ...(picture ? { profilePicUrl: picture } : {}),
        },
      ).catch(() => {});

      synced++;
    }

    return { ok: true, syncedCount: synced };
  } catch (err) {
    return {
      ok: false,
      syncedCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

