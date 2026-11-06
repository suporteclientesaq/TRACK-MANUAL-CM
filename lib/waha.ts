import { normalizePhone } from "./normalize";
import type { ParsedEvolutionLead } from "./evolution";

/**
 * Parser de Webhook do WAHA (WhatsApp HTTP API - devlikeapro/waha).
 * Suporta engines WEBJS (Puppeteer) e NOWEB (Baileys).
 *
 * Ao receber a mensagem de lead Click-to-WhatsApp via WAHA:
 * 1. Extrai o telefone do remetente (payload.from)
 * 2. Extrai ctwa_clid (payload._data.contextInfo.ctwaClid ou conversionData)
 * 3. Extrai dados do anúncio (externalAdReply ou tags no texto como [AD:123456])
 */
export function parseWahaWebhook(
  body: Record<string, unknown>
): { ok: true; lead: ParsedEvolutionLead } | { ok: false; ignored?: boolean; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Payload vazio ou inválido." };
  }

  // WAHA envia o evento no campo 'event' (ex: 'message', 'message.any')
  const event = String(body.event || "");
  if (event && !event.startsWith("message")) {
    return { ok: false, ignored: true, error: `Evento WAHA "${event}" ignorado.` };
  }

  const session = typeof body.session === "string" ? body.session : "default";

  // Objeto principal de mensagem no WAHA fica em body.payload
  const payload = (body.payload || body) as Record<string, unknown>;

  const fromMe = Boolean(payload.fromMe);
  if (fromMe) {
    return { ok: false, ignored: true, error: "Mensagem enviada pelo próprio número (fromMe: true)." };
  }

  const rawFrom = String(payload.from || payload.author || "");
  if (!rawFrom) {
    return { ok: false, error: "Nenhum remetente ('from') encontrado no payload do WAHA." };
  }

  // Ignora grupos e transmissões/status
  if (rawFrom.includes("@g.us") || rawFrom.includes("@broadcast")) {
    return { ok: false, ignored: true, error: "Mensagem de grupo ou broadcast ignorada." };
  }

  const rawPhone = rawFrom.replace(/@.*$/, "").replace(/\D/g, "");
  const phone = normalizePhone(rawPhone);
  if (!phone) {
    return { ok: false, error: `Telefone inválido extraído do remetente: ${rawFrom}` };
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

  // ContextInfo do WhatsApp Web
  const contextInfo =
    (data.contextInfo as Record<string, unknown>) ||
    (payload.contextInfo as Record<string, unknown>) ||
    {};

  // CTWA Click ID
  let ctwa_clid: string | null = null;
  const rawCtwa = contextInfo.ctwaClid || contextInfo.ctwa_clid || data.ctwaClid || payload.ctwaClid;
  if (typeof rawCtwa === "string" && rawCtwa.trim()) {
    ctwa_clid = rawCtwa.trim();
  }

  // Se conversionData veio em Base64, decodifica
  if (!ctwa_clid && contextInfo.conversionData) {
    try {
      const rawConv = String(contextInfo.conversionData);
      const decoded = Buffer.from(rawConv, "base64").toString("utf-8");
      const m = decoded.match(/([a-zA-Z0-9_-]{20,})/);
      if (m) ctwa_clid = m[1];
    } catch {
      // Ignora erro
    }
  }

  // Dados do anúncio (externalAdReply)
  const adReply =
    (contextInfo.externalAdReply as Record<string, unknown>) ||
    (data.externalAdReply as Record<string, unknown>) ||
    {};

  let source_id: string | null = null;
  const rawSourceId =
    adReply.sourceId ??
    adReply.source_id ??
    adReply.adId ??
    adReply.ad_id ??
    contextInfo.sourceId;
  if (rawSourceId != null) {
    const s = String(rawSourceId).trim();
    if (s && s !== "0" && s !== "null" && s !== "undefined") {
      source_id = s;
    }
  }

  const rawSourceUrl = adReply.sourceUrl || adReply.source_url;
  let source_url = typeof rawSourceUrl === "string" && rawSourceUrl.trim() ? rawSourceUrl.trim() : null;

  if (source_url) {
    try {
      const u = new URL(source_url);
      if (!ctwa_clid) {
        ctwa_clid = u.searchParams.get("ctwa_clid") || u.searchParams.get("fbclid") || null;
      }
      if (!source_id) {
        const urlAd = u.searchParams.get("ad_id") || u.searchParams.get("hsa_ad") || u.searchParams.get("ad");
        if (urlAd) source_id = urlAd;
      }
    } catch {
      if (!ctwa_clid) {
        const m = source_url.match(/(?:ctwa_clid|fbclid)=([^&]+)/i);
        if (m) ctwa_clid = decodeURIComponent(m[1]);
      }
      if (!source_id) {
        const m = source_url.match(/(?:ad_id|hsa_ad)=(\d+)/i);
        if (m) source_id = m[1];
      }
    }
  }

  // Rastreamento por TAG no texto da mensagem caso ctwa_clid/source_id venha vazio
  if (!source_id && messageText) {
    const tagMatch =
      messageText.match(/\[(?:AD|REF|COD|ANUNCIO|ID|ANÚNCIO)[:\s-]*(\d{6,})\]/i) ||
      messageText.match(/(?:AD|REF|COD|ANUNCIO|ANÚNCIO)[:\s-]+(\d{6,})/i) ||
      messageText.match(/(?:hsa_ad|ad_id)=(\d{6,})/i);
    if (tagMatch) {
      source_id = tagMatch[1];
    }
  }

  const rawThumb = adReply.thumbnailUrl || adReply.thumbnail_url;
  const thumbnail_url = typeof rawThumb === "string" && rawThumb.trim() ? rawThumb.trim() : null;

  const rawMedia = adReply.mediaUrl || adReply.media_url;
  const media_url = typeof rawMedia === "string" && rawMedia.trim() ? rawMedia.trim() : null;

  const rawTitle = adReply.title || adReply.headline;
  const headline = typeof rawTitle === "string" && rawTitle.trim() ? rawTitle.trim() : null;

  const rawBody = adReply.body || adReply.ad_body;
  const ad_body = typeof rawBody === "string" && rawBody.trim() ? rawBody.trim() : null;

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
    },
  };
}
