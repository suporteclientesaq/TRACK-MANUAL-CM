import "server-only";
import { extractBaileysProtobufAd } from "./ctwa";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  downloadMediaMessage,
  type WASocket,
  type ConnectionState,
} from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ingestLead } from "./ingest";
import {
  parseEvolutionWebhook,
  phoneFromWhatsAppJid,
  whatsappTimestamp,
} from "./evolution";
import { getSetting, setSettings } from "./store";
import { normalizePhone } from "./normalize";
import { appSecret } from "./config";
import { encrypt, decrypt } from "./crypto";

export function isServerlessEnvironment(): boolean {
  return Boolean(
    process.env.NETLIFY ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.VERCEL ||
    (typeof process.cwd === "function" &&
      process.cwd().startsWith("/var/task")),
  );
}

interface NativeSession {
  clientId: string;
  socket: WASocket | null;
  state: "open" | "connecting" | "close";
  qrcode: string | null;
  phone: string | null;
  name: string | null;
  error?: string;
  qrWaiters: Array<() => void>;
  isConnecting: boolean;
}

// Map global em Node.js para manter as sessões ativas através de hot-reloads e requisições
const g = globalThis as unknown as {
  __nativeWhatsAppSessions?: Map<string, NativeSession>;
  __nativeWhatsAppConnects?: Map<string, Promise<NativeConnectResult>>;
};
if (!g.__nativeWhatsAppSessions) {
  g.__nativeWhatsAppSessions = new Map<string, NativeSession>();
}
const sessions = g.__nativeWhatsAppSessions;
const connects = (g.__nativeWhatsAppConnects ||= new Map());
type NativeConnectResult = {
  ok: boolean;
  state: "open" | "connecting" | "close";
  qrcode: string | null;
  phone?: string | null;
  error?: string;
};

function sessionResult(session: NativeSession) {
  return {
    ok: !session.error,
    state: session.state,
    qrcode: session.qrcode,
    phone: session.phone,
    name: session.name,
    error: session.error,
  };
}

function settleConnectionWaiters(session: NativeSession): void {
  for (const resolve of session.qrWaiters.splice(0)) resolve();
}

async function waitForConnection(session: NativeSession, timeoutMs: number) {
  if (session.state === "connecting" && !session.qrcode) {
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        const index = session.qrWaiters.indexOf(finish);
        if (index !== -1) session.qrWaiters.splice(index, 1);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      session.qrWaiters.push(finish);
    });
  }
  return sessionResult(session);
}

function getBaseSessionDir(): string {
  if (process.env.TRACK_DATA_DIR?.trim())
    return process.env.TRACK_DATA_DIR.trim();
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
      await setSettings({
        [`wa_session_${clientId}`]: encrypt(
          JSON.stringify(bundle),
          await appSecret(),
        ),
      });
    }
  } catch (err) {
    console.warn(
      "[Track Manual] Aviso ao salvar backup de sessão do WhatsApp no banco:",
      err,
    );
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

    const bundle = JSON.parse(
      data.startsWith("v1.") ? decrypt(data, await appSecret()) : data,
    ) as Record<string, string>;
    for (const [filename, content] of Object.entries(bundle)) {
      if (
        !/^[a-zA-Z0-9_+=-]+\.json$/.test(filename) ||
        typeof content !== "string"
      )
        continue;
      const fullPath = path.resolve(sessionDir, filename);
      if (path.dirname(fullPath) !== path.resolve(sessionDir)) continue;
      fs.writeFileSync(fullPath, content, { encoding: "utf-8", mode: 0o600 });
    }
    console.log(
      `[Track Manual] Sessão do WhatsApp do cliente ${clientId} restaurada com sucesso do Banco Postgres!`,
    );
    return true;
  } catch (err) {
    console.warn(
      "[Track Manual] Erro ao restaurar sessão do WhatsApp do banco:",
      err,
    );
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

export async function getNativeWhatsAppStatus(
  clientId: string,
  options: { reconnect?: boolean } = {},
): Promise<{
  ok: boolean;
  state: "open" | "connecting" | "close";
  qrcode: string | null;
  phone: string | null;
  name: string | null;
  error?: string;
}> {
  const session = sessions.get(clientId);
  // A status read never reports a saved credential as an active connection.
  if (session) return sessionResult(session);
  if (options.reconnect !== false && !isServerlessEnvironment()) {
    const safeId = clientId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const credentials = path.join(
      getBaseSessionDir(),
      "whatsapp_sessions",
      safeId,
      "creds.json",
    );
    const saved =
      fs.existsSync(credentials) ||
      Boolean(await getSetting(`wa_session_${clientId}`));
    if (saved) {
      connectNativeWhatsApp(clientId).catch(() => {});
      return {
        ok: true,
        state: "connecting",
        qrcode: null,
        phone: null,
        name: null,
      };
    }
  }
  return { ok: true, state: "close", qrcode: null, phone: null, name: null };
}

/** One in-flight connection per client, including credential restoration awaits. */
export function connectNativeWhatsApp(
  clientId: string,
): Promise<NativeConnectResult> {
  const existing = connects.get(clientId);
  if (existing) return existing;
  const pending = establishNativeWhatsApp(clientId)
    .catch((error: unknown) => {
      const message = error instanceof Error
        ? error.message
        : "Não foi possível iniciar a sessão.";
      const current = sessions.get(clientId);
      if (current) {
        current.isConnecting = false;
        current.state = "close";
        current.qrcode = null;
        current.error = message;
        settleConnectionWaiters(current);
      }
      return {
        ok: false,
        state: "close" as const,
        qrcode: null,
        error: message,
      };
    })
    .finally(() => {
      if (connects.get(clientId) === pending) connects.delete(clientId);
    });
  connects.set(clientId, pending);
  return pending;
}

async function establishNativeWhatsApp(clientId: string): Promise<{
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
  if (session && session.isConnecting) {
    return waitForConnection(session, 8_000);
  }

  // Se já existia um socket antigo fechado, encerra limpo antes de abrir um novo
  if (session?.socket) {
    const previousSocket = session.socket;
    session.socket = null;
    try {
      previousSocket.end(undefined);
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
      isConnecting: true,
    };
    sessions.set(clientId, session);
  }

  session.state = "connecting";
  session.isConnecting = true;
  session.error = undefined;
  session.qrcode = null;
  const sessionDir = getSessionDir(clientId);
  await restoreSessionFromDb(clientId);
  const { state: authState, saveCreds } =
    await useMultiFileAuthState(sessionDir);

  const sock = makeWASocket({
    auth: authState,
    logger: pino({ level: "silent" }),
    syncFullHistory: true,
    connectTimeoutMs: 45_000,
    keepAliveIntervalMs: 25_000,
    browser: ["Windows", "Chrome", "122.0.0.0"],
  });

  session.socket = sock;
  session.isConnecting = true;

  sock.ev.on("creds.update", async () => {
    if (sessions.get(clientId)?.socket !== sock) return;
    await saveCreds();
    await backupSessionToDb(clientId);
  });

  // Monitora alterações de conexão e QR Code
  sock.ev.on("connection.update", async (update: Partial<ConnectionState>) => {
    if (sessions.get(clientId)?.socket !== sock) return;
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
        if (sessions.get(clientId)?.socket !== sock || session!.state !== "connecting")
          return;
        session!.qrcode = qrDataUrl;
        session!.state = "connecting";
        session!.error = undefined;

        // Notifica quem estiver esperando pelo QR
        settleConnectionWaiters(session!);
      } catch (err) {
        console.error("[Baileys QR Error]", err);
      }
    }

    if (connection === "open") {
      session!.state = "open";
      session!.qrcode = null;
      session!.isConnecting = false;
      session!.error = undefined;
      session!.phone = sock.user?.id
        ? sock.user.id.split(":")[0].replace(/\D/g, "")
        : null;
      session!.name = sock.user?.name || null;
      settleConnectionWaiters(session!);
      console.log(
        `[Track Manual] WhatsApp Conectado com sucesso para cliente ${clientId}! Número: ${session!.phone}`,
      );
      backupSessionToDb(clientId).catch(() => {});
    }

    if (connection === "close") {
      const statusCode = (
        lastDisconnect?.error as { output?: { statusCode?: number } }
      )?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;

      console.log(
        `[Track Manual] WhatsApp desconectado (código ${statusCode}). LoggedOut: ${isLoggedOut}`,
      );

      session!.state = "close";
      session!.qrcode = null;
      session!.isConnecting = false;
      const shouldReconnect = !isLoggedOut &&
        (authState.creds.registered || statusCode === DisconnectReason.restartRequired) &&
        !isServerlessEnvironment();
      session!.error = shouldReconnect ? undefined : isLoggedOut
        ? "O WhatsApp encerrou a sessão. Clique em Salvar e conectar para gerar outro QR Code."
        : `Não foi possível conectar ao WhatsApp${statusCode ? ` (código ${statusCode})` : ""}. Tente novamente. Se persistir, confira a saída HTTPS/WebSocket da VPS para web.whatsapp.com.`;
      settleConnectionWaiters(session!);

      if (isLoggedOut) {
        cleanSessionDir(clientId);
        session!.phone = null;
        session!.name = null;
      } else if (shouldReconnect) {
        console.log(
          `[Track Manual] WhatsApp temporariamente desconectado. Reconectando em 3s...`,
        );
        setTimeout(() => {
          if (sessions.get(clientId) !== session || session?.socket !== sock)
            return;
          connectNativeWhatsApp(clientId).catch((err) =>
            console.warn("[Track Manual] Erro na auto-reconexão Baileys:", err),
          );
        }, 3000);
      }
    }
  });

  // Captura inteligente de mensagens Click-to-WhatsApp
  sock.ev.on("messages.upsert", async ({ messages, type }: any) => {
    if (sessions.get(clientId)?.socket !== sock || type !== "notify") return;

    for (const msg of messages) {
      try {
        if (!msg.message) continue;
        const remoteJid = msg.key.remoteJid || "";
        if (remoteJid.includes("@g.us") || remoteJid.includes("@broadcast"))
          continue;

        // Extrai ctwa_clid e dados de anúncio diretamente do protobuf Baileys
        const { bctwa, bAdId, bAdTitle, bAdBody, bAdThumb, bAdUrl, bAdMedia } =
          extractBaileysProtobufAd(msg.message as Record<string, unknown>);

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

        const parsed = parseEvolutionWebhook(
          {
            event: "messages.upsert",
            data: msgData as unknown as Record<string, unknown>,
          },
          { includeOutgoing: true },
        );

        if (!parsed.ok) continue;

        // Mescla campos extraídos diretamente do protobuf Baileys com o resultado do parser
        const hasDirectReferral = Boolean(
          bctwa ||
          bAdId ||
          bAdUrl ||
          bAdTitle ||
          bAdBody ||
          bAdThumb ||
          bAdMedia,
        );
        const finalCtwa = hasDirectReferral ? bctwa : parsed.lead.ctwa_clid;
        const finalAdId = hasDirectReferral ? bAdId : parsed.lead.source_id;
        const finalAdTitle = hasDirectReferral
          ? bAdTitle
          : parsed.lead.headline;
        const finalAdBody = hasDirectReferral ? bAdBody : parsed.lead.ad_body;
        const finalAdThumb = hasDirectReferral
          ? bAdThumb
          : parsed.lead.thumbnail_url;
        const finalAdUrl = hasDirectReferral ? bAdUrl : parsed.lead.source_url;

        console.log(
          `[Track Manual] Mensagem WhatsApp (${msg.key.fromMe ? "enviada" : "recebida"}) de ${parsed.lead.phone}! ctwa_clid: ${finalCtwa || "nenhum"}, adId: ${finalAdId || "nenhum"}`,
        );

        const pushName = msg.key.fromMe ? "" : (msg.pushName || "").trim();
        const isAudio = Boolean(
          msg.message?.audioMessage || msg.message?.voiceMessage,
        );
        const isImage = Boolean(msg.message?.imageMessage);
        const isDoc = Boolean(msg.message?.documentMessage);
        const msgType = isAudio
          ? "audio"
          : isImage
            ? "image"
            : isDoc
              ? "document"
              : "text";

        let profilePicUrl: string | null = null;
        try {
          if (sock && remoteJid && !msg.key.fromMe) {
            profilePicUrl =
              (await sock
                .profilePictureUrl(remoteJid, "image")
                .catch(() => null)) || null;
          }
        } catch {}

        let attachmentBase64: string | null = null;
        if (parsed.lead.type !== "text") {
          try {
            const fileLength =
              msg.message?.audioMessage?.fileLength ||
              msg.message?.imageMessage?.fileLength ||
              msg.message?.videoMessage?.fileLength ||
              msg.message?.documentMessage?.fileLength;
            const size = Number(fileLength || 0);
            if (!size || size <= 8 * 1024 * 1024) {
              const attachment = await downloadMediaMessage(
                msg,
                "buffer",
                {},
                {
                  logger: pino({ level: "silent" }),
                  reuploadRequest: sock.updateMediaMessage,
                },
              );
              if (attachment.length <= 8 * 1024 * 1024)
                attachmentBase64 = attachment.toString("base64");
            }
          } catch {
            // Text and metadata remain visible when an attachment expires or exceeds the local limit.
          }
        }

        await ingestLead(
          clientId,
          {
            name: pushName || parsed.lead.name || null,
            phone: parsed.lead.phone,
            ctwa_clid: finalCtwa,
            source_id: finalAdId,
            source_url: finalAdUrl,
            thumbnail_url: finalAdThumb,
            media_url: hasDirectReferral ? bAdMedia : parsed.lead.media_url,
            headline: finalAdTitle,
            ad_body: finalAdBody,
            notes: parsed.lead.message_text
              ? `WhatsApp: "${parsed.lead.message_text}"`
              : null,
          },
          "manual",
          {
            origin: "whatsapp-direto",
            received_at:
              whatsappTimestamp(msg.messageTimestamp) ||
              new Date().toISOString(),
            message_id: msg.key.id || null,
            provider: "baileys",
            instance: "baileys_nativo",
            message_text:
              parsed.lead.message_text ||
              (isAudio
                ? "[Áudio do WhatsApp]"
                : isImage
                  ? "[Foto do WhatsApp]"
                  : "[Mídia]"),
            fromMe: Boolean(msg.key.fromMe),
            ctwa_clid: finalCtwa,
            source_id: finalAdId,
            pushName: pushName || undefined,
            type: parsed.lead.type || msgType,
            mimetype: parsed.lead.mimetype,
            filename: parsed.lead.filename,
            base64: attachmentBase64,
            ...(profilePicUrl ? { profilePicUrl } : {}),
            contextInfo: (msg.message?.extendedTextMessage?.contextInfo ||
              msg.message?.contextInfo ||
              {}) as Record<string, unknown>,
          },
        );
      } catch (err) {
        console.error(
          "[Track Manual] Erro ao processar mensagem do WhatsApp:",
          err,
        );
      }
    }
  });

  // Atualiza os nomes dos contatos em tempo real conforme chegam do WhatsApp
  sock.ev.on("contacts.upsert", async (contacts: any[]) => {
    try {
      const { findLead, updateLead } = await import("./store");
      for (const c of contacts) {
        const cjid = c.id || "";
        if (cjid.includes("@g.us") || cjid.includes("@broadcast")) continue;
        const cphone = phoneFromWhatsAppJid(cjid, c.phoneNumber);
        const cname = (
          c.notify ||
          (c as any).name ||
          (c as any).verifiedName ||
          ""
        ).trim();
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
  sock.ev.on(
    "messaging-history.set",
    async ({ chats, contacts, messages, isLatest }: any) => {
      console.log(
        `[Track Manual] Sincronizando histórico do WhatsApp: ${chats.length} chats, ${contacts.length} contatos, ${messages.length} mensagens.`,
      );
      try {
        // Mapeia nomes reais dos contatos fornecidos pelo WhatsApp
        const contactsMap = new Map<string, string>();
        for (const c of contacts || []) {
          const cjid = c.id || "";
          const cphone = phoneFromWhatsAppJid(cjid, c.phoneNumber);
          const cname = (
            c.notify ||
            (c as any).name ||
            (c as any).verifiedName ||
            ""
          ).trim();
          if (cphone && cname) {
            contactsMap.set(cphone, cname);
          }
        }

        // 1. Cria imediatamente todos os contatos e conversas existentes no celular com os nomes reais
        for (const chat of chats) {
          const jid = chat.id || "";
          if (jid.includes("@g.us") || jid.includes("@broadcast")) continue;
          const phone = phoneFromWhatsAppJid(jid, chat.phoneNumber);
          if (!phone || phone.length < 8) continue;

          const resolvedName =
            (chat.name || "").trim() || contactsMap.get(phone) || null;

          await ingestLead(
            clientId,
            {
              name: resolvedName,
              phone,
            },
            "manual",
            {
              origin: "whatsapp-direto",
              received_at: new Date(
                Number(chat.conversationTimestamp || 0) * 1000 || Date.now(),
              ).toISOString(),
              instance: "baileys_nativo",
            },
          ).catch(() => {});
        }

        // 2. Extrai mensagens históricas de todas as conversas
        for (const msg of messages) {
          if (!msg.message) continue;
          const remoteJid = msg.key.remoteJid || "";
          if (remoteJid.includes("@g.us") || remoteJid.includes("@broadcast"))
            continue;

          const {
            bctwa,
            bAdId,
            bAdTitle,
            bAdBody,
            bAdThumb,
            bAdUrl,
            bAdMedia,
          } = extractBaileysProtobufAd(msg.message as Record<string, unknown>);

          const msgData = {
            ...(msg as unknown as Record<string, unknown>),
            _baileys_ctwa_clid: bctwa,
            _baileys_source_id: bAdId,
            _baileys_headline: bAdTitle,
            _baileys_ad_body: bAdBody,
            _baileys_thumbnail_url: bAdThumb,
            _baileys_source_url: bAdUrl,
          };

          const parsed = parseEvolutionWebhook(
            {
              event: "messages.upsert",
              data: msgData as unknown as Record<string, unknown>,
            },
            { includeOutgoing: true },
          );
          if (!parsed.ok) continue;

          const hasDirectReferral = Boolean(
            bctwa ||
            bAdId ||
            bAdUrl ||
            bAdTitle ||
            bAdBody ||
            bAdThumb ||
            bAdMedia,
          );
          const finalCtwa = hasDirectReferral ? bctwa : parsed.lead.ctwa_clid;
          const finalAdId = hasDirectReferral ? bAdId : parsed.lead.source_id;
          const finalAdTitle = hasDirectReferral
            ? bAdTitle
            : parsed.lead.headline;
          const finalAdBody = hasDirectReferral ? bAdBody : parsed.lead.ad_body;
          const finalAdThumb = hasDirectReferral
            ? bAdThumb
            : parsed.lead.thumbnail_url;
          const finalAdUrl = hasDirectReferral
            ? bAdUrl
            : parsed.lead.source_url;

          await ingestLead(
            clientId,
            {
              name: parsed.lead.name,
              phone: parsed.lead.phone,
              ctwa_clid: finalCtwa,
              source_id: finalAdId,
              source_url: finalAdUrl,
              thumbnail_url: finalAdThumb,
              media_url: hasDirectReferral ? bAdMedia : parsed.lead.media_url,
              headline: finalAdTitle,
              ad_body: finalAdBody,
              notes: parsed.lead.message_text
                ? `WhatsApp: "${parsed.lead.message_text}"`
                : null,
            },
            "manual",
            {
              origin: "whatsapp-direto",
              received_at:
                whatsappTimestamp(msg.messageTimestamp) ||
                new Date().toISOString(),
              message_id: msg.key.id || null,
              provider: "baileys",
              type: parsed.lead.type,
              mimetype: parsed.lead.mimetype,
              filename: parsed.lead.filename,
              instance: "baileys_nativo",
              message_text: parsed.lead.message_text,
              fromMe: Boolean(msg.key.fromMe),
              ctwa_clid: finalCtwa,
              source_id: finalAdId,
              contextInfo: (msg.message?.extendedTextMessage?.contextInfo ||
                msg.message?.contextInfo ||
                {}) as Record<string, unknown>,
            },
          );
        }
      } catch (err) {
        console.warn("[Track Manual] Aviso ao sincronizar histórico:", err);
      }
    },
  );

  return waitForConnection(session, 10_000);
}

/** Send success is independent from later local-history persistence. */
export async function sendNativeWhatsAppMessage(
  clientId: string,
  phone: string,
  text: string,
): Promise<{
  ok: boolean;
  error?: string;
  warning?: string;
  messageId?: string;
}> {
  const session = sessions.get(clientId);
  if (!session?.socket || session.state !== "open")
    return {
      ok: false,
      error: "WhatsApp não está conectado para este cliente.",
    };
  const cleanPhone = normalizePhone(phone);
  if (!cleanPhone || !text.trim())
    return { ok: false, error: "Informe telefone e mensagem válidos." };
  try {
    const sent = await session.socket.sendMessage(
      `${cleanPhone}@s.whatsapp.net`,
      { text },
    );
    const messageId = sent?.key.id || undefined;
    try {
      await ingestLead(clientId, { phone: cleanPhone }, "manual", {
        origin: "whatsapp-direto",
        provider: "baileys",
        message_id: messageId,
        received_at:
          whatsappTimestamp(sent?.messageTimestamp) || new Date().toISOString(),
        instance: "baileys_nativo",
        message_text: text,
        fromMe: true,
        type: "text",
      });
      return { ok: true, messageId };
    } catch {
      return {
        ok: true,
        messageId,
        warning:
          "Mensagem enviada, mas o histórico não foi atualizado. Não reenvie para evitar duplicidade.",
      };
    }
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível enviar a mensagem.",
    };
  }
}

export async function sendNativeWhatsAppMedia(
  clientId: string,
  phone: string,
  media: {
    base64: string;
    mimetype: string;
    filename?: string;
    caption?: string;
  },
): Promise<{
  ok: boolean;
  error?: string;
  warning?: string;
  messageId?: string;
}> {
  const session = sessions.get(clientId);
  if (!session?.socket || session.state !== "open")
    return {
      ok: false,
      error: "WhatsApp não está conectado para este cliente.",
    };
  const cleanPhone = normalizePhone(phone);
  if (!cleanPhone) return { ok: false, error: "Telefone inválido." };
  const base64 = media.base64.replace(/^data:.*?;base64,/, "");
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length || buffer.length > 8 * 1024 * 1024)
    return { ok: false, error: "Envie um arquivo de até 8 MB." };
  const type = media.mimetype.startsWith("image/")
    ? "image"
    : media.mimetype.startsWith("audio/")
      ? "audio"
      : media.mimetype.startsWith("video/")
        ? "video"
        : "document";
  try {
    const jid = `${cleanPhone}@s.whatsapp.net`;
    const sent =
      type === "image"
        ? await session.socket.sendMessage(jid, {
            image: buffer,
            caption: media.caption,
            mimetype: media.mimetype,
          })
        : type === "audio"
          ? await session.socket.sendMessage(jid, {
              audio: buffer,
              mimetype: media.mimetype,
              ptt: true,
            })
          : type === "video"
            ? await session.socket.sendMessage(jid, {
                video: buffer,
                caption: media.caption,
                mimetype: media.mimetype,
              })
            : await session.socket.sendMessage(jid, {
                document: buffer,
                mimetype: media.mimetype,
                fileName: media.filename || "arquivo",
                caption: media.caption,
              });
    const messageId = sent?.key.id || undefined;
    try {
      await ingestLead(clientId, { phone: cleanPhone }, "manual", {
        origin: "whatsapp-direto",
        provider: "baileys",
        message_id: messageId,
        received_at:
          whatsappTimestamp(sent?.messageTimestamp) || new Date().toISOString(),
        instance: "baileys_nativo",
        message_text: media.caption || media.filename || "Anexo enviado",
        fromMe: true,
        type,
        mimetype: media.mimetype,
        filename: media.filename,
        base64,
      });
      return { ok: true, messageId };
    } catch {
      return {
        ok: true,
        messageId,
        warning:
          "Arquivo enviado, mas o histórico não foi atualizado. Não reenvie para evitar duplicidade.",
      };
    }
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível enviar o arquivo.",
    };
  }
}

export async function disconnectNativeWhatsApp(
  clientId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = sessions.get(clientId);
  sessions.delete(clientId);
  connects.delete(clientId);
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
