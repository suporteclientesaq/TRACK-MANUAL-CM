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
}

export function getNativeWhatsAppStatus(clientId: string): {
  ok: boolean;
  state: "open" | "connecting" | "close";
  qrcode: string | null;
  phone: string | null;
  name: string | null;
} {
  const session = sessions.get(clientId);
  if (session) {
    return {
      ok: true,
      state: session.state,
      qrcode: session.qrcode,
      phone: session.phone,
      name: session.name,
    };
  }

  // Se não está em memória, verifica se já existe uma sessão salva em disco
  const sessionDir = getSessionDir(clientId);
  const credsFile = path.join(sessionDir, "creds.json");
  if (fs.existsSync(credsFile)) {
    try {
      const creds = JSON.parse(fs.readFileSync(credsFile, "utf-8"));
      if (creds?.me?.id) {
        const phone = creds.me.id.split(":")[0].replace(/\D/g, "");
        return {
          ok: true,
          state: "close", // Arquivo existe mas precisa iniciar socket
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
    state: "close",
    qrcode: null,
    phone: null,
    name: null,
  };
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

  if (session && session.state === "connecting" && session.qrcode) {
    return {
      ok: true,
      state: "connecting",
      qrcode: session.qrcode,
    };
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
  const { state: authState, saveCreds } = await useMultiFileAuthState(sessionDir);

  const sock = makeWASocket({
    auth: authState,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    connectTimeoutMs: 15_000,
    keepAliveIntervalMs: 25_000,
    browser: ["Track Manual", "Chrome", "1.0.0"],
  });

  session.socket = sock;
  session.isConnecting = true;

  sock.ev.on("creds.update", saveCreds);

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
      }
    }
  });

  // Captura inteligente de mensagens Click-to-WhatsApp
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      try {
        if (!msg.message || msg.key.fromMe) continue;
        const remoteJid = msg.key.remoteJid || "";
        if (remoteJid.includes("@g.us") || remoteJid.includes("@broadcast")) continue;

        // Usa o parser que já trata todos os campos (CTWA, externalAdReply, headline, source_id)
        const parsed = parseEvolutionWebhook({
          event: "messages.upsert",
          data: msg as unknown as Record<string, unknown>,
        });

        if (!parsed.ok) continue;

        console.log(`[Track Manual] Nova mensagem WhatsApp recebida de ${parsed.lead.phone}! ctwa_clid: ${parsed.lead.ctwa_clid || "nenhum"}, adId: ${parsed.lead.source_id || "nenhum"}`);

        await ingestLead(
          clientId,
          {
            name: parsed.lead.name,
            phone: parsed.lead.phone,
            ctwa_clid: parsed.lead.ctwa_clid,
            source_id: parsed.lead.source_id,
            source_url: parsed.lead.source_url,
            thumbnail_url: parsed.lead.thumbnail_url,
            media_url: parsed.lead.media_url,
            headline: parsed.lead.headline,
            ad_body: parsed.lead.ad_body,
            notes: parsed.lead.message_text ? `WhatsApp: "${parsed.lead.message_text}"` : null,
          },
          "manual",
          {
            origin: "whatsapp-direto",
            received_at: new Date().toISOString(),
            instance: "baileys_nativo",
            message_text: parsed.lead.message_text,
          }
        );
      } catch (err) {
        console.error("[Track Manual] Erro ao processar mensagem do WhatsApp:", err);
      }
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
