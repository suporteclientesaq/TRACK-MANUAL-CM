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
}

export function parseEvolutionWebhook(
  payload: Record<string, unknown>
): { ok: true; lead: ParsedEvolutionLead } | { ok: false; ignored?: boolean; error: string } {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "Payload inválido ou vazio." };
  }

  const instance = typeof payload.instance === "string" ? payload.instance : null;

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
  if (fromMe) {
    return { ok: false, ignored: true, error: "Mensagem enviada pelo próprio número (fromMe: true)." };
  }

  const rawJid = String(key.remoteJid || item.remoteJid || item.phone || "");
  if (!rawJid) {
    return { ok: false, error: "Nenhum remoteJid ou telefone encontrado no webhook." };
  }

  // Ignora mensagens de grupos (@g.us), status/stories (@broadcast)
  if (rawJid.includes("@g.us") || rawJid.includes("@broadcast")) {
    return { ok: false, ignored: true, error: "Mensagem de grupo ou broadcast ignorada." };
  }

  const rawPhone = rawJid.replace(/@.*$/, "").replace(/\D/g, "");
  const phone = normalizePhone(rawPhone);
  if (!phone) {
    return { ok: false, error: `Telefone inválido extraído do remoteJid: ${rawJid}` };
  }

  const name =
    typeof item.pushName === "string" && item.pushName.trim()
      ? item.pushName.trim()
      : typeof item.verifiedName === "string" && item.verifiedName.trim()
        ? item.verifiedName.trim()
        : null;

  // Busca dados de contextInfo e anúncio (CTWA) dentro da mensagem
  const message = (item.message || {}) as Record<string, unknown>;

  // Extrai texto da conversa
  const conversation =
    typeof message.conversation === "string"
      ? message.conversation
      : typeof (message.extendedTextMessage as Record<string, unknown>)?.text === "string"
        ? String((message.extendedTextMessage as Record<string, unknown>).text)
        : null;

  // contextInfo pode estar em vários lugares dependendo do tipo da mensagem
  const extended = (message.extendedTextMessage || {}) as Record<string, unknown>;
  const imageMsg = (message.imageMessage || {}) as Record<string, unknown>;
  const videoMsg = (message.videoMessage || {}) as Record<string, unknown>;

  const contextInfo =
    (extended.contextInfo as Record<string, unknown>) ||
    (imageMsg.contextInfo as Record<string, unknown>) ||
    (videoMsg.contextInfo as Record<string, unknown>) ||
    (message.contextInfo as Record<string, unknown>) ||
    (item.contextInfo as Record<string, unknown>) ||
    {};

  // CTWA Click ID
  const ctwaClidRaw =
    contextInfo.ctwaClid ||
    contextInfo.conversionData ||
    contextInfo.ctwa_clid ||
    item.ctwaClid ||
    null;
  const ctwa_clid = typeof ctwaClidRaw === "string" && ctwaClidRaw.trim() ? ctwaClidRaw.trim() : null;

  // Dados do anúncio (externalAdReply)
  const adReply =
    (contextInfo.externalAdReply as Record<string, unknown>) ||
    (item.externalAdReply as Record<string, unknown>) ||
    {};

  const sourceIdRaw = adReply.sourceId || adReply.source_id || adReply.adId || item.source_id;
  const source_id = typeof sourceIdRaw === "string" && sourceIdRaw.trim() ? sourceIdRaw.trim() : null;

  const sourceUrlRaw = adReply.sourceUrl || adReply.source_url || item.source_url;
  const source_url = typeof sourceUrlRaw === "string" && sourceUrlRaw.trim() ? sourceUrlRaw.trim() : null;

  const thumbRaw = adReply.thumbnailUrl || adReply.thumbnail_url || item.thumbnail_url;
  const thumbnail_url = typeof thumbRaw === "string" && thumbRaw.trim() ? thumbRaw.trim() : null;

  const mediaRaw = adReply.mediaUrl || adReply.media_url || item.media_url;
  const media_url = typeof mediaRaw === "string" && mediaRaw.trim() ? mediaRaw.trim() : null;

  const titleRaw = adReply.title || adReply.headline || item.headline;
  const headline = typeof titleRaw === "string" && titleRaw.trim() ? titleRaw.trim() : null;

  const bodyRaw = adReply.body || adReply.ad_body || item.ad_body;
  const ad_body = typeof bodyRaw === "string" && bodyRaw.trim() ? bodyRaw.trim() : null;

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

export async function evolutionGetState(config: EvolutionConfig): Promise<{
  ok: boolean;
  state: "open" | "connecting" | "close" | "not_found";
  error?: string;
}> {
  const base = config.serverUrl.replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/instance/connectionState/${encodeURIComponent(config.instanceName)}`, {
      headers: { apikey: config.apiKey },
      cache: "no-store",
    });
    const json = (await res.json()) as any;
    if (!res.ok) {
      if (res.status === 404 || json?.error?.includes?.("not found") || json?.response?.message?.includes?.("not found")) {
        return { ok: true, state: "not_found" };
      }
      return { ok: false, state: "close", error: json?.message || `Erro ${res.status}` };
    }
    const state = json?.instance?.state || json?.state || "close";
    return { ok: true, state };
  } catch (e) {
    return { ok: false, state: "close", error: e instanceof Error ? e.message : String(e) };
  }
}

export async function evolutionSetWebhook(
  config: EvolutionConfig,
  webhookUrl: string
): Promise<{ ok: boolean; error?: string }> {
  const base = config.serverUrl.replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/webhook/set/${encodeURIComponent(config.instanceName)}`, {
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
      cache: "no-store",
    });
    return { ok: res.ok };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function evolutionCreateOrConnect(
  config: EvolutionConfig,
  webhookUrl?: string
): Promise<{
  ok: boolean;
  state: "open" | "connecting" | "close";
  qrcode: string | null;
  error?: string;
}> {
  const base = config.serverUrl.replace(/\/+$/, "");

  // 1. Verifica estado atual
  const current = await evolutionGetState(config);
  if (current.ok && current.state === "open") {
    if (webhookUrl) await evolutionSetWebhook(config, webhookUrl);
    return { ok: true, state: "open", qrcode: null };
  }

  // 2. Se a instância não existe, cria
  if (current.state === "not_found") {
    try {
      const createRes = await fetch(`${base}/instance/create`, {
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
        cache: "no-store",
      });
      const json = (await createRes.json()) as any;
      if (createRes.ok) {
        if (webhookUrl) await evolutionSetWebhook(config, webhookUrl);
        const qr = json?.qrcode?.base64 || json?.base64 || null;
        return { ok: true, state: "connecting", qrcode: qr };
      }
    } catch (e) {
      return { ok: false, state: "close", qrcode: null, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // 3. Se já existe mas está desconectada, chama connect para obter novo QR Code
  try {
    const connRes = await fetch(`${base}/instance/connect/${encodeURIComponent(config.instanceName)}`, {
      headers: { apikey: config.apiKey },
      cache: "no-store",
    });
    const json = (await connRes.json()) as any;
    if (webhookUrl) await evolutionSetWebhook(config, webhookUrl);
    const qr = json?.base64 || json?.qrcode?.base64 || null;
    return { ok: true, state: "connecting", qrcode: qr };
  } catch (e) {
    return { ok: false, state: "close", qrcode: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function evolutionLogout(config: EvolutionConfig): Promise<{ ok: boolean; error?: string }> {
  const base = config.serverUrl.replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/instance/logout/${encodeURIComponent(config.instanceName)}`, {
      method: "DELETE",
      headers: { apikey: config.apiKey },
      cache: "no-store",
    });
    return { ok: res.ok };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

