import "server-only";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  type WASocket,
  type ConnectionState,
} from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ingestLead } from "./ingest";
import { parseEvolutionWebhook } from "./evolution";
import { getSetting, setSettings } from "./store";

export function isServerlessEnvironment(): boolean {
  return Boolean(
    process.env.NETLIFY ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.VERCEL ||
    (typeof process.cwd === "function" && process.cwd().startsWith("/var/task"))
  );
}

interface NativeSession {
  clientId: string;
  socket: WASocket | null;
  state: "open" | "connecting" | "close";
  qrcode: string | null;
  phone: string | null;
  name: string | null;
  qrWaiters: Array<(qr: string) => void>;
  isConnecting: boolean;
}

// Map global em Node.js para manter as sessões ativas através de hot-reloads e requisições
const g = globalThis as unknown as {
  __nativeWhatsAppSessions?: Map<string, NativeSession>;
};
if (!g.__nativeWhatsAppSessions) {
  g.__nativeWhatsAppSessions = new Map<string, NativeSession>();
}
const sessions = g.__nativeWhatsAppSessions;

function getBaseSessionDir(): string {
  if (process.env.TRACK_DATA_DIR?.trim()) return process.env.TRACK_DATA_DIR.trim();
  if (isServerlessEnvironment()) {
    return path.join(os.tmpdir(), "track_data");
  }
  return path.join(process.cwd(), "data");
}

function getSessionDir(clientId: string): string {
  const safeId = clientId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const dir = path.join(getBaseSessionDir(), "whatsapp_sessions", safeId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Salva todos os arquivos da sessão do Baileys no banco de dados Postgres permanentemente */
async function backupSessionToDb(clientId: string): Promise<void> {
  try {
    const sessionDir = getSessionDir(clientId);
    if (!fs.existsSync(sessionDir)) return;
    const files = fs.readdirSync(sessionDir);
    const bundle: Record<string, string> = {};
    for (const f of files) {
      const fullPath = path.join(sessionDir, f);
      try {
        if (fs.statSync(fullPath).isFile()) {
          bundle[f] = fs.readFileSync(fullPath, "utf-8");
        }
      } catch {
        // ignora arquivo temporário ou travado
      }
    }
    if (Object.keys(bundle).length > 0) {
      await setSettings({ [`wa_session_${clientId}`]: JSON.stringify(bundle) });
    }
  } catch (err) {
    console.warn("[Track Manual] Aviso ao salvar backup de sessão do WhatsApp no banco:", err);
  }
}

/** Restaura a sessão do WhatsApp do banco de dados Postgres se o container reiniciou e o disco local estiver vazio */
async function restoreSessionFromDb(clientId: string): Promise<boolean> {
  try {
    const sessionDir = getSessionDir(clientId);
    const credsFile = path.join(sessionDir, "creds.json");
    if (fs.existsSync(credsFile)) return true;

    const data = await getSetting(`wa_session_${clientId}`);
    if (!data) return false;

    const bundle = JSON.parse(data) as Record<string, string>;
    for (const [filename, content] of Object.entries(bundle)) {
      const fullPath = path.join(sessionDir, filename);
      fs.writeFileSync(fullPath, content, "utf-8");
    }
    console.log(`[Track Manual] Sessão do WhatsApp do cliente ${clientId} restaurada com sucesso do Banco Postgres!`);
    return true;
  } catch (err) {
    console.warn("[Track Manual] Erro ao restaurar sessão do WhatsApp do banco:", err);
    return false;
  }
}

function cleanSessionDir(clientId: string): void {
  const safeId = clientId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const dir = path.join(getBaseSessionDir(), "whatsapp_sessions", safeId);
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    // ignora erros de limpeza de arquivo bloqueado
  }
  // Remove do banco também ao desconectar manualmente
  setSettings({ [`wa_session_${clientId}`]: "" }).catch(() => {});
}

export async function getNativeWhatsAppStatus(clientId: string): Promise<{
  ok: boolean;
  state: "open" | "connecting" | "close";
  qrcode: string | null;
  phone: string | null;
  name: string | null;
}> {
  let session = sessions.get(clientId);
  if (session && session.state === "open") {
    return {
      ok: true,
      state: session.state,
      qrcode: session.qrcode,
      phone: session.phone,
      name: session.name,
    };
  }

  // Se não está em memória, verifica se já existe uma sessão salva em disco ou no banco
  const sessionDir = getSessionDir(clientId);
  const credsFile = path.join(sessionDir, "creds.json");

  // Se o arquivo creds.json não existe no disco local, tenta restaurar imediatamente do banco
  if (!fs.existsSync(credsFile)) {
    await restoreSessionFromDb(clientId).catch(() => {});
  }

  session = sessions.get(clientId);
  if (session && session.state === "open") {
    return {
      ok: true,
      state: session.state,
      qrcode: session.qrcode,
      phone: session.phone,
      name: session.name,
    };
  }

  if (fs.existsSync(credsFile)) {
    try {
      const creds = JSON.parse(fs.readFileSync(credsFile, "utf-8"));
      if (creds?.me?.id) {
        const phone = creds.me.id.split(":")[0].replace(/\D/g, "");
        // Inicia a reconexão automática imediatamente se ainda não estiver ocorrendo
        if (!isServerlessEnvironment()) {
          const current = sessions.get(clientId);
          if (!current || (!current.socket && !current.isConnecting)) {
            connectNativeWhatsApp(clientId).catch((err) =>
              console.warn("[Track Manual] Auto-start WhatsApp na consulta de status:", err)
            );
          }
        }
        return {
          ok: true,
          state: "open", // Preserva a indicação de conectado enquanto o Baileys retoma em background
          qrcode: null,
          phone,
          name: creds.me.name || null,
        };
      }
    } catch {
      // json corrompido
    }
  }

  return {
    ok: true,
    state: session?.state || "close",
    qrcode: session?.qrcode || null,
    phone: session?.phone || null,
    name: session?.name || null,
  };
}

function extractBaileysProtobufAd(rawMsg: Record<string, unknown> | undefined) {
  let bctwa: string | null = null;
  let bAdId: string | null = null;
  let bAdTitle: string | null = null;
  let bAdBody: string | null = null;
  let bAdThumb: string | null = null;
  let bAdUrl: string | null = null;

  if (!rawMsg || typeof rawMsg !== "object") {
    return { bctwa, bAdId, bAdTitle, bAdBody, bAdThumb, bAdUrl };
  }

  const msgTypes = [
    rawMsg.extendedTextMessage,
    rawMsg.imageMessage,
    rawMsg.videoMessage,
    rawMsg.documentMessage,
    rawMsg.audioMessage,
    rawMsg.stickerMessage,
    rawMsg,
  ] as Array<Record<string, unknown> | undefined>;

  for (const msgObj of msgTypes) {
    if (!msgObj || typeof msgObj !== "object") continue;
    const ci = (msgObj.contextInfo || {}) as Record<string, unknown>;
    if (!ci || typeof ci !== "object") continue;

    const ear = (ci.externalAdReply || {}) as Record<string, unknown>;
    if (ear && typeof ear === "object") {
      if (!bAdId) {
        const sid = ear.sourceId ?? ear.source_id ?? ear.adId ?? ear.ad_id;
        if (sid) bAdId = String(sid).trim();
      }
      if (!bAdTitle) {
        const t = ear.title ?? ear.headline;
        if (t) bAdTitle = String(t).trim();
      }
      if (!bAdBody) {
        const b = ear.body ?? ear.ad_body;
        if (b) bAdBody = String(b).trim();
      }
      if (!bAdThumb) {
        const th = ear.thumbnailUrl ?? ear.thumbnail_url;
        if (th) bAdThumb = String(th).trim();
      }
      if (!bAdUrl) {
        const su = ear.sourceUrl ?? ear.source_url;
        if (su) bAdUrl = String(su).trim();
      }
    }

    const rawClid =
      ci.ctwaClid ??
      ci.conversionData ??
      ci.ctwa_clid ??
      ci.conversion_data ??
      ear.ctwaClid ??
      ear.ctwa_clid ??
      ear.conversionData ??
      null;

    if (rawClid && !bctwa) {
      if (Buffer.isBuffer(rawClid) || rawClid instanceof Uint8Array) {
        const buf = Buffer.from(rawClid);
        if (buf.length > 0) {
          const utf8 = buf.toString("utf-8").trim();
          const m = utf8.match(/([a-zA-Z0-9+/=_-]{20,})/);
          if (m && m[1].length >= 20) {
            bctwa = m[1];
          } else {
            const b64 = buf.toString("base64").trim();
            if (b64 && b64.length >= 16) bctwa = b64;
          }
        }
      } else if (typeof rawClid === "string" && rawClid.trim()) {
        bctwa = rawClid.trim();
        if (/^[A-Za-z0-9+/=]{24,}$/.test(bctwa) && !bctwa.includes(" ")) {
          try {
            const dec = Buffer.from(bctwa, "base64").toString("utf-8");
            const m = dec.match(/([a-zA-Z0-9_-]{20,})/);
            if (m) bctwa = m[1];
          } catch {}
        }
      } else {
        const s = String(rawClid).trim();
        if (s && s !== "[object Object]" && s !== "null" && s !== "undefined") bctwa = s;
      }
    }

    if (!bctwa && bAdUrl) {
      try {
        const u = new URL(bAdUrl);
        const urlClid = u.searchParams.get("ctwa_clid") || u.searchParams.get("fbclid");
        if (urlClid) bctwa = urlClid;
      } catch {
        const m = bAdUrl.match(/(?:ctwa_clid|fbclid)=([^&]+)/i);
        if (m) bctwa = decodeURIComponent(m[1]);
      }
    }

    if (bctwa && bAdId) break;
  }

  return { bctwa, bAdId, bAdTitle, bAdBody, bAdThumb, bAdUrl };
}

export async function connectNativeWhatsApp(clientId: string): Promise<{
  ok: boolean;
  state: "open" | "connecting" | "close";
  qrcode: string | null;
  phone?: string | null;
  error?: string;
}> {
  if (isServerlessEnvironment()) {
    return {
      ok: false,
      state: "close",
      qrcode: null,
      error:
        "O modo 'WhatsApp Direto' roda como processo contínuo no seu computador (iniciar.bat) ou VPS. Na Netlify/nuvem serverless, conexões em segundo plano não podem ficar abertas. Para usar na Netlify, utilize a aba 'Evolution API (Servidor)'.",
    };
  }

  let session = sessions.get(clientId);

  if (session && session.state === "open" && session.socket) {
    return {
      ok: true,
      state: "open",
      qrcode: null,
      phone: session.phone,
    };
  }

  // Se já está conectando com socket ativo, apenas aguarda ou devolve o QR existente sem destruir
  if (session && session.isConnecting && session.socket) {
    if (session.qrcode) {
      return {
        ok: true,
        state: "connecting",
        qrcode: session.qrcode,
      };
    }
    // Aguarda o QR ser gerado pelo socket que já está em conexão ativa
    const qrPromise = new Promise<string>((resolve) => {
      session!.qrWaiters.push(resolve);
    });
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000));
    const generatedQr = await Promise.race([qrPromise, timeoutPromise]);
    if (session.state === "open") {
      return { ok: true, state: "open", qrcode: null, phone: session.phone };
    }
    return {
      ok: true,
      state: "connecting",
      qrcode: generatedQr || session.qrcode || null,
    };
  }

  // Se já existia um socket antigo fechado, encerra limpo antes de abrir um novo
  if (session?.socket) {
    try {
      session.socket.end(undefined);
    } catch {
      // ignora
    }
  }

  if (!session) {
    session = {
      clientId,
      socket: null,
      state: "connecting",
      qrcode: null,
      phone: null,
      name: null,
      qrWaiters: [],
      isConnecting: false,
    };
    sessions.set(clientId, session);
  }

  const sessionDir = getSessionDir(clientId);
  await restoreSessionFromDb(clientId);
  const { state: authState, saveCreds } = await useMultiFileAuthState(sessionDir);

  const sock = makeWASocket({
    auth: authState,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    syncFullHistory: true,
    connectTimeoutMs: 45_000,
    keepAliveIntervalMs: 25_000,
    browser: ["Windows", "Chrome", "122.0.0.0"],
  });

  session.socket = sock;
  session.isConnecting = true;

  sock.ev.on("creds.update", async () => {
    await saveCreds();
    await backupSessionToDb(clientId);
  });

  // Monitora alterações de conexão e QR Code
  sock.ev.on("connection.update", async (update: Partial<ConnectionState>) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        const qrDataUrl = await QRCode.toDataURL(qr, {
          margin: 2,
          scale: 7,
          color: {
            dark: "#000000",
            light: "#ffffff",
          },
        });
        session!.qrcode = qrDataUrl;
        session!.state = "connecting";

        // Notifica quem estiver esperando pelo QR
        while (session!.qrWaiters.length > 0) {
          const waiter = session!.qrWaiters.shift();
          waiter?.(qrDataUrl);
        }
      } catch (err) {
        console.error("[Baileys QR Error]", err);
      }
    }

    if (connection === "open") {
      session!.state = "open";
      session!.qrcode = null;
      session!.isConnecting = false;
      session!.phone = sock.user?.id ? sock.user.id.split(":")[0].replace(/\D/g, "") : null;
      session!.name = sock.user?.name || null;
      console.log(`[Track Manual] WhatsApp Conectado com sucesso para cliente ${clientId}! Número: ${session!.phone}`);
      backupSessionToDb(clientId).catch(() => {});
    }

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;

      console.log(`[Track Manual] WhatsApp desconectado (código ${statusCode}). LoggedOut: ${isLoggedOut}`);

      session!.state = "close";
      session!.qrcode = null;
      session!.isConnecting = false;

      if (isLoggedOut) {
        cleanSessionDir(clientId);
        session!.phone = null;
        session!.name = null;
      } else if (!isServerlessEnvironment()) {
        console.log(`[Track Manual] WhatsApp temporariamente desconectado. Reconectando em 3s...`);
        setTimeout(() => {
          connectNativeWhatsApp(clientId).catch((err) =>
            console.warn("[Track Manual] Erro na auto-reconexão Baileys:", err)
          );
        }, 3000);
      }
    }
  });

  // Captura inteligente de mensagens Click-to-WhatsApp
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      try {
        if (!msg.message) continue;
        const remoteJid = msg.key.remoteJid || "";
        if (remoteJid.includes("@g.us") || remoteJid.includes("@broadcast")) continue;

        // Extrai ctwa_clid e dados de anúncio diretamente do protobuf Baileys
        const { bctwa, bAdId, bAdTitle, bAdBody, bAdThumb, bAdUrl } = extractBaileysProtobufAd(
          msg.message as Record<string, unknown>
        );

        // Usa o parser que já trata todos os campos (CTWA, externalAdReply, headline, source_id)
        // Injeta os campos extraídos diretamente no data para garantir que o parser os capture
        const msgData = {
          ...(msg as unknown as Record<string, unknown>),
          // Injeta campos de CTWA e anúncio extraídos diretamente do contextInfo Baileys
          _baileys_ctwa_clid: bctwa,
          _baileys_source_id: bAdId,
          _baileys_headline: bAdTitle,
          _baileys_ad_body: bAdBody,
          _baileys_thumbnail_url: bAdThumb,
          _baileys_source_url: bAdUrl,
        };

        const parsed = parseEvolutionWebhook({
          event: "messages.upsert",
          data: msgData as unknown as Record<string, unknown>,
        });

        if (!parsed.ok) continue;

        // Mescla campos extraídos diretamente do protobuf Baileys com o resultado do parser
        const finalCtwa = bctwa || parsed.lead.ctwa_clid;
        const finalAdId = bAdId || parsed.lead.source_id;
        const finalAdTitle = bAdTitle || parsed.lead.headline;
        const finalAdBody = bAdBody || parsed.lead.ad_body;
        const finalAdThumb = bAdThumb || parsed.lead.thumbnail_url;
        const finalAdUrl = bAdUrl || parsed.lead.source_url;

        console.log(`[Track Manual] Mensagem WhatsApp (${msg.key.fromMe ? "enviada" : "recebida"}) de ${parsed.lead.phone}! ctwa_clid: ${finalCtwa || "nenhum"}, adId: ${finalAdId || "nenhum"}`);

        const pushName = (msg.pushName || "").trim();
        await ingestLead(
          clientId,
          {
            name: pushName || parsed.lead.name || undefined,
            phone: parsed.lead.phone,
            ctwa_clid: finalCtwa,
            source_id: finalAdId,
            source_url: finalAdUrl,
            thumbnail_url: finalAdThumb,
            media_url: parsed.lead.media_url,
            headline: finalAdTitle,
            ad_body: finalAdBody,
            notes: parsed.lead.message_text ? `WhatsApp: "${parsed.lead.message_text}"` : null,
          },
          "manual",
          {
            origin: "whatsapp-direto",
            received_at: new Date().toISOString(),
            instance: "baileys_nativo",
            message_text: parsed.lead.message_text,
            fromMe: Boolean(msg.key.fromMe),
            ctwa_clid: finalCtwa,
            source_id: finalAdId,
            pushName: pushName || undefined,
            contextInfo: (msg.message?.extendedTextMessage?.contextInfo || msg.message?.contextInfo || {}) as Record<string, unknown>,
          }
        );
      } catch (err) {
        console.error("[Track Manual] Erro ao processar mensagem do WhatsApp:", err);
      }
    }
  });

  // Atualiza os nomes dos contatos em tempo real conforme chegam do WhatsApp
  sock.ev.on("contacts.upsert", async (contacts) => {
    try {
      const { findLead, updateLead } = await import("./store");
      for (const c of contacts) {
        const cjid = c.id || "";
        if (cjid.includes("@g.us") || cjid.includes("@broadcast")) continue;
        const cphone = cjid.replace(/@.*$/, "").replace(/\D/g, "");
        const cname = (c.notify || (c as any).name || (c as any).verifiedName || "").trim();
        if (cphone && cname) {
          const lead = await findLead(clientId, cphone);
          if (lead && (!lead.name || lead.name === "Sem Nome")) {
            await updateLead(lead.id, { name: cname });
          }
        }
      }
    } catch {}
  });

  // Sincronização automática do histórico completo de conversas anteriores do celular
  sock.ev.on("messaging-history.set", async ({ chats, contacts, messages, isLatest }) => {
    console.log(`[Track Manual] Sincronizando histórico do WhatsApp: ${chats.length} chats, ${contacts.length} contatos, ${messages.length} mensagens.`);
    try {
      // Mapeia nomes reais dos contatos fornecidos pelo WhatsApp
      const contactsMap = new Map<string, string>();
      for (const c of contacts || []) {
        const cjid = c.id || "";
        const cphone = cjid.replace(/@.*$/, "").replace(/\D/g, "");
        const cname = (c.notify || (c as any).name || (c as any).verifiedName || "").trim();
        if (cphone && cname) {
          contactsMap.set(cphone, cname);
        }
      }

      // 1. Cria imediatamente todos os contatos e conversas existentes no celular com os nomes reais
      for (const chat of chats) {
        const jid = chat.id || "";
        if (jid.includes("@g.us") || jid.includes("@broadcast")) continue;
        const phone = jid.replace(/@.*$/, "").replace(/\D/g, "");
        if (!phone || phone.length < 8) continue;

        const resolvedName = (chat.name || "").trim() || contactsMap.get(phone) || null;

        await ingestLead(
          clientId,
          {
            name: resolvedName,
            phone,
          },
          "manual",
          {
            origin: "whatsapp-direto",
            received_at: new Date(Number(chat.conversationTimestamp || 0) * 1000 || Date.now()).toISOString(),
            instance: "baileys_nativo",
          }
        ).catch(() => {});
      }

      // 2. Extrai mensagens históricas de todas as conversas
      for (const msg of messages) {
        if (!msg.message) continue;
        const remoteJid = msg.key.remoteJid || "";
        if (remoteJid.includes("@g.us") || remoteJid.includes("@broadcast")) continue;

        const { bctwa, bAdId, bAdTitle, bAdBody, bAdThumb, bAdUrl } = extractBaileysProtobufAd(
          msg.message as Record<string, unknown>
        );

        const msgData = {
          ...(msg as unknown as Record<string, unknown>),
          _baileys_ctwa_clid: bctwa,
          _baileys_source_id: bAdId,
          _baileys_headline: bAdTitle,
          _baileys_ad_body: bAdBody,
          _baileys_thumbnail_url: bAdThumb,
          _baileys_source_url: bAdUrl,
        };

        const parsed = parseEvolutionWebhook({
          event: "messages.upsert",
          data: msgData as unknown as Record<string, unknown>,
        });
        if (!parsed.ok) continue;

        const finalCtwa = bctwa || parsed.lead.ctwa_clid;
        const finalAdId = bAdId || parsed.lead.source_id;
        const finalAdTitle = bAdTitle || parsed.lead.headline;
        const finalAdBody = bAdBody || parsed.lead.ad_body;
        const finalAdThumb = bAdThumb || parsed.lead.thumbnail_url;
        const finalAdUrl = bAdUrl || parsed.lead.source_url;

        await ingestLead(
          clientId,
          {
            name: parsed.lead.name,
            phone: parsed.lead.phone,
            ctwa_clid: finalCtwa,
            source_id: finalAdId,
            source_url: finalAdUrl,
            thumbnail_url: finalAdThumb,
            media_url: parsed.lead.media_url,
            headline: finalAdTitle,
            ad_body: finalAdBody,
            notes: parsed.lead.message_text ? `WhatsApp: "${parsed.lead.message_text}"` : null,
          },
          "manual",
          {
            origin: "whatsapp-direto",
            received_at: new Date(Number(msg.messageTimestamp || 0) * 1000 || Date.now()).toISOString(),
            instance: "baileys_nativo",
            message_text: parsed.lead.message_text,
            fromMe: Boolean(msg.key.fromMe),
            ctwa_clid: finalCtwa,
            source_id: finalAdId,
            contextInfo: (msg.message?.extendedTextMessage?.contextInfo || msg.message?.contextInfo || {}) as Record<string, unknown>,
          }
        );
      }
    } catch (err) {
      console.warn("[Track Manual] Aviso ao sincronizar histórico:", err);
    }
  });

  // Aguarda até 10 segundos pelo primeiro QR code ou confirmação de conexão
  if (session.state === "open") {
    return { ok: true, state: "open", qrcode: null, phone: session.phone };
  }
  if (session.qrcode) {
    return { ok: true, state: "connecting", qrcode: session.qrcode };
  }

  const qrPromise = new Promise<string>((resolve) => {
    session!.qrWaiters.push(resolve);
  });

  const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000));

  const generatedQr = await Promise.race([qrPromise, timeoutPromise]);

  const currentState = session.state as "open" | "connecting" | "close";
  if (currentState === "open") {
    return { ok: true, state: "open", qrcode: null, phone: session.phone };
  }

  if (generatedQr) {
    return { ok: true, state: "connecting", qrcode: generatedQr };
  }

  // Se demorou mais de 10s, retorna o estado atual (o front pode dar poll)
  return {
    ok: true,
    state: session.state,
    qrcode: session.qrcode,
  };
}

/** Envia mensagem de texto diretamente pelo WhatsApp nativo do Track Manual */
export async function sendNativeWhatsAppMessage(
  clientId: string,
  phone: string,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  const session = sessions.get(clientId);
  if (!session || !session.socket || session.state !== "open") {
    return { ok: false, error: "WhatsApp não está conectado para este cliente." };
  }

  try {
    const cleanPhone = phone.replace(/\D/g, "");
    const jid = `${cleanPhone}@s.whatsapp.net`;
    await session.socket.sendMessage(jid, { text });

    // Grava no histórico da conversa do lead
    await ingestLead(
      clientId,
      { phone: cleanPhone },
      "manual",
      {
        origin: "whatsapp-direto",
        received_at: new Date().toISOString(),
        instance: "baileys_nativo",
        message_text: text,
        fromMe: true,
      }
    );

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Envia arquivo, foto ou documento pelo WhatsApp nativo do Track Manual */
export async function sendNativeWhatsAppMedia(
  clientId: string,
  phone: string,
  media: {
    base64: string;
    mimetype: string;
    filename?: string;
    caption?: string;
  }
): Promise<{ ok: boolean; error?: string }> {
  const session = sessions.get(clientId);
  if (!session || !session.socket || session.state !== "open") {
    return { ok: false, error: "WhatsApp não está conectado para este cliente." };
  }

  try {
    const cleanPhone = phone.replace(/\D/g, "");
    const jid = `${cleanPhone}@s.whatsapp.net`;
    const cleanB64 = media.base64.replace(/^data:.*?;base64,/, "");
    const buffer = Buffer.from(cleanB64, "base64");

    if (media.mimetype.startsWith("image/")) {
      await session.socket.sendMessage(jid, {
        image: buffer,
        caption: media.caption || undefined,
        mimetype: media.mimetype,
      });
    } else if (media.mimetype.startsWith("audio/")) {
      await session.socket.sendMessage(jid, {
        audio: buffer,
        mimetype: media.mimetype,
        ptt: true,
      });
    } else {
      await session.socket.sendMessage(jid, {
        document: buffer,
        mimetype: media.mimetype,
        fileName: media.filename || "arquivo.pdf",
        caption: media.caption || undefined,
      });
    }

    // Grava no histórico da conversa do lead
    await ingestLead(
      clientId,
      { phone: cleanPhone },
      "manual",
      {
        origin: "whatsapp-direto",
        received_at: new Date().toISOString(),
        instance: "baileys_nativo",
        message_text: media.caption ? `📷 ${media.caption}` : `📎 [Arquivo: ${media.filename || "Mídia"}]`,
        fromMe: true,
        type: media.mimetype.startsWith("image/") ? "image" : media.mimetype.startsWith("audio/") ? "audio" : "document",
      }
    );

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function disconnectNativeWhatsApp(clientId: string): Promise<{ ok: boolean; error?: string }> {
  const session = sessions.get(clientId);
  if (session?.socket) {
    try {
      await session.socket.logout();
    } catch {
      try {
        session.socket.end(undefined);
      } catch {
        // ignora
      }
    }
  }

  cleanSessionDir(clientId);
  sessions.delete(clientId);

  return { ok: true };
}
