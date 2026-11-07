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

  // Unwraps wrapper message types (ephemeral, viewOnce, documentWithCaption)
  let rawMessage = (item.message || {}) as Record<string, unknown>;
  let depth = 0;
  while (depth < 5) {
    depth++;
    const inner =
      (rawMessage.ephemeralMessage as Record<string, unknown>)?.message ||
      (rawMessage.viewOnceMessage as Record<string, unknown>)?.message ||
      (rawMessage.viewOnceMessageV2 as Record<string, unknown>)?.message ||
      (rawMessage.documentWithCaptionMessage as Record<string, unknown>)?.message;
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
  const btn = (rawMessage.buttonsResponseMessage || {}) as Record<string, unknown>;
  const tpl = (rawMessage.templateButtonReplyMessage || {}) as Record<string, unknown>;

  const conversation =
    typeof rawMessage.conversation === "string" && rawMessage.conversation.trim()
      ? rawMessage.conversation.trim()
      : typeof ext.text === "string" && ext.text.trim()
        ? ext.text.trim()
        : typeof img.caption === "string" && img.caption.trim()
          ? img.caption.trim()
          : typeof vid.caption === "string" && vid.caption.trim()
            ? vid.caption.trim()
            : typeof doc.caption === "string" && doc.caption.trim()
              ? doc.caption.trim()
              : typeof btn.selectedButtonText === "string" && btn.selectedButtonText.trim()
                ? btn.selectedButtonText.trim()
                : typeof tpl.selectedDisplayText === "string" && tpl.selectedDisplayText.trim()
                  ? tpl.selectedDisplayText.trim()
                  : null;

  // contextInfo pode estar em vários lugares dependendo do tipo da mensagem
  const contextInfo =
    (ext.contextInfo as Record<string, unknown>) ||
    (img.contextInfo as Record<string, unknown>) ||
    (vid.contextInfo as Record<string, unknown>) ||
    (doc.contextInfo as Record<string, unknown>) ||
    (rawMessage.contextInfo as Record<string, unknown>) ||
    (item.contextInfo as Record<string, unknown>) ||
    {};

  // CTWA Click ID com conversão de Buffer / Uint8Array / Base64 (Protobuf Baileys / Evolution)
  const ctwaClidRaw =
    contextInfo.ctwaClid ||
    contextInfo.conversionData ||
    contextInfo.ctwa_clid ||
    contextInfo.conversion_data ||
    item.ctwaClid ||
    item.ctwa_clid ||
    null;

  let ctwa_clid: string | null = null;
  if (ctwaClidRaw != null) {
    if (typeof ctwaClidRaw === "string" && ctwaClidRaw.trim()) {
      const trimmed = ctwaClidRaw.trim();
      // Se parecer base64 sem espaços, tenta decodificar para checar se tem ctwa_clid embutido
      if (/^[A-Za-z0-9+/=_-]{30,}$/.test(trimmed)) {
        ctwa_clid = trimmed;
      } else {
        ctwa_clid = trimmed;
      }
    } else if (Buffer.isBuffer(ctwaClidRaw)) {
      const s = ctwaClidRaw.toString("utf-8").trim();
      if (s) ctwa_clid = s;
    } else if (ctwaClidRaw instanceof Uint8Array) {
      const s = Buffer.from(ctwaClidRaw).toString("utf-8").trim();
      if (s) ctwa_clid = s;
    } else {
      const s = String(ctwaClidRaw).trim();
      if (s && s !== "[object Object]") ctwa_clid = s;
    }
  }

  // Se conversionData veio em Base64 separado, tenta extrair string de tracking
  if (!ctwa_clid && contextInfo.conversionData && typeof contextInfo.conversionData === "string") {
    try {
      const decoded = Buffer.from(contextInfo.conversionData, "base64").toString("utf-8");
      const m = decoded.match(/([a-zA-Z0-9_-]{20,})/);
      if (m) ctwa_clid = m[1];
    } catch {
      // Ignora erro de base64
    }
  }

  // Dados do anúncio (externalAdReply)
  const adReply =
    (contextInfo.externalAdReply as Record<string, unknown>) ||
    (item.externalAdReply as Record<string, unknown>) ||
    {};

  const sourceIdRaw =
    adReply.sourceId ??
    adReply.source_id ??
    adReply.adId ??
    adReply.ad_id ??
    item.sourceId ??
    item.source_id;

  let source_id: string | null = null;
  if (sourceIdRaw != null) {
    const s = String(sourceIdRaw).trim();
    if (s && s !== "0" && s !== "null" && s !== "undefined") {
      source_id = s;
    }
  }

  const sourceUrlRaw = adReply.sourceUrl || adReply.source_url || item.source_url;
  let source_url = typeof sourceUrlRaw === "string" && sourceUrlRaw.trim() ? sourceUrlRaw.trim() : null;

  // Se ctwa_clid ou source_id não veio no contextInfo, tenta resgatar da URL do anúncio
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

  // Rastreamento por TAG na Mensagem Pré-definida do Anúncio (Ex: [AD:120247299656290265] ou [REF:123456])
  // Isso garante 100% de atribuição mesmo se o WhatsApp não mandar o ctwa_clid!
  if (!source_id && conversation) {
    const tagMatch =
      conversation.match(/\[(?:AD|REF|COD|ANUNCIO|ID|ANÚNCIO)[:\s-]*(\d{6,})\]/i) ||
      conversation.match(/(?:AD|REF|COD|ANUNCIO|ANÚNCIO)[:\s-]+(\d{6,})/i) ||
      conversation.match(/(?:hsa_ad|ad_id)=(\d{6,})/i);
    if (tagMatch) {
      source_id = tagMatch[1];
    }
  }

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
  options: RequestInit = {}
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
    if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
      return {
        ok: false,
        status: 503,
        data: null,
        error: `Não foi possível conectar ao servidor (${url}). Verifique se a Evolution API está em execução no endereço e porta informados.`,
      };
    }
    return { ok: false, status: 500, data: null, error: `Erro de conexão: ${msg}` };
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
  return { ok: true, state, phone: phone ? String(phone).replace(/\D/g, "") : null };
}

export async function evolutionSetWebhook(
  config: EvolutionConfig,
  webhookUrl: string
): Promise<{ ok: boolean; error?: string }> {
  const base = normalizeBaseUrl(config.serverUrl);
  const res = await safeFetchJson(`${base}/webhook/set/${encodeURIComponent(config.instanceName)}`, {
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
  });
  return { ok: res.ok, error: res.error };
}

export async function evolutionCreateOrConnect(
  config: EvolutionConfig,
  webhookUrl?: string
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
      error: current.error || "Não foi possível verificar a instância da Evolution API.",
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
      return { ok: false, state: "close", qrcode: null, error: createRes.error };
    }

    if (webhookUrl) await evolutionSetWebhook(config, webhookUrl);
    const json = createRes.data as any;
    const qr = json?.qrcode?.base64 || json?.base64 || json?.code || null;
    return { ok: true, state: "connecting", qrcode: qr };
  }

  // 3. Se já existe mas está desconectada, chama connect para obter novo QR Code
  const connRes = await safeFetchJson(`${base}/instance/connect/${encodeURIComponent(config.instanceName)}`, {
    headers: { apikey: config.apiKey },
  });

  if (!connRes.ok) {
    return { ok: false, state: "close", qrcode: null, error: connRes.error };
  }

  if (webhookUrl) await evolutionSetWebhook(config, webhookUrl);
  const json = connRes.data as any;
  const qr = json?.base64 || json?.qrcode?.base64 || json?.code || null;
  return { ok: true, state: "connecting", qrcode: qr };
}

export async function evolutionLogout(config: EvolutionConfig): Promise<{ ok: boolean; error?: string }> {
  const base = normalizeBaseUrl(config.serverUrl);
  const res = await safeFetchJson(`${base}/instance/logout/${encodeURIComponent(config.instanceName)}`, {
    method: "DELETE",
    headers: { apikey: config.apiKey },
  });
  return { ok: res.ok, error: res.error };
}


