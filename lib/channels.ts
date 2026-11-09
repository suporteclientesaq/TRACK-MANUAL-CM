import "server-only";
import { getClient, getSetting, setSettings, listClients } from "./store";
import { appSecret } from "./config";
import { decrypt, encrypt } from "./crypto";
import {
  getNativeWhatsAppStatus,
  connectNativeWhatsApp,
  disconnectNativeWhatsApp,
} from "./whatsapp-baileys";
import {
  wahaCreateOrConnect,
  wahaGetState,
  wahaGetQrCode,
  wahaLogout,
} from "./waha";
import {
  evolutionCreateOrConnect,
  evolutionGetState,
  evolutionLogout,
} from "./evolution";

export type ChannelProvider = "native" | "waha" | "evolution";
export interface ChannelConfiguration {
  provider: ChannelProvider;
  serverUrl: string;
  sessionName: string;
  apiKey: string;
}
export interface PublicChannelConfiguration {
  provider: ChannelProvider;
  serverUrl: string;
  sessionName: string;
  hasApiKey: boolean;
}
export interface ChannelStatus {
  ok: boolean;
  state: "open" | "connecting" | "close";
  qrcode: string | null;
  phone: string | null;
  error?: string;
}
const provider = (value: unknown): ChannelProvider =>
  value === "waha" || value === "evolution" ? value : "native";

export async function channelConfiguration(
  clientId: string,
): Promise<ChannelConfiguration> {
  const raw = await getSetting("whatsapp_config_" + clientId);
  if (!raw)
    return {
      provider: "native",
      serverUrl: "",
      sessionName: "track_" + clientId.replaceAll("-", "").slice(0, 16),
      apiKey: "",
    };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      provider: provider(parsed.provider),
      serverUrl: typeof parsed.serverUrl === "string" ? parsed.serverUrl : "",
      sessionName:
        typeof parsed.sessionName === "string" ? parsed.sessionName : "default",
      apiKey:
        typeof parsed.apiKeyEnc === "string" && parsed.apiKeyEnc
          ? decrypt(parsed.apiKeyEnc, await appSecret())
          : "",
    };
  } catch {
    throw new Error(
      "Não foi possível ler as credenciais do canal. Confira a configuração e o segredo da instalação.",
    );
  }
}
export async function publicChannelConfiguration(
  clientId: string,
): Promise<PublicChannelConfiguration> {
  const { apiKey, ...config } = await channelConfiguration(clientId);
  return { ...config, hasApiKey: !!apiKey };
}
export async function saveChannelConfiguration(
  clientId: string,
  input: {
    provider: unknown;
    serverUrl?: string;
    sessionName?: string;
    apiKey?: string;
  },
): Promise<void> {
  if (!(await getClient(clientId))) throw new Error("Cliente não encontrado.");
  const existing = await channelConfiguration(clientId);
  const selected = provider(input.provider);
  const sessionName = (input.sessionName || existing.sessionName).trim();
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(sessionName))
    throw new Error(
      "Use um nome de sessão com letras, números, hífen ou sublinhado.",
    );
  let serverUrl = "";
  if (selected !== "native") {
    let url: URL;
    try {
      url = new URL(input.serverUrl || "");
    } catch {
      throw new Error("Informe o endereço do servidor.");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        "Use um endereço HTTP ou HTTPS sem credenciais ou parâmetros.",
      );
    serverUrl = url.toString().replace(/\/$/, "");
  }
  const apiKey =
    input.apiKey?.trim() ||
    (existing.provider === selected ? existing.apiKey : "");
  if (apiKey.length > 4096) throw new Error("Chave de acesso inválida.");
  if (selected === "evolution" && !apiKey)
    throw new Error("Informe a chave de acesso da Evolution.");
  const apiKeyEnc = apiKey ? encrypt(apiKey, await appSecret()) : "";
  await setSettings({
    ["whatsapp_config_" + clientId]: JSON.stringify({
      provider: selected,
      serverUrl,
      sessionName,
      apiKeyEnc,
    }),
    ["whatsapp_provider_" + clientId]: selected,
  });
}
export async function channelStatus(clientId: string): Promise<ChannelStatus> {
  const config = await channelConfiguration(clientId);
  if (config.provider === "native") {
    const status = await getNativeWhatsAppStatus(clientId, {
      reconnect: false,
    });
    return { ...status, phone: status.phone || null };
  }
  if (!config.serverUrl)
    return {
      ok: false,
      state: "close",
      phone: null,
      qrcode: null,
      error: "Configure o endereço do servidor.",
    };
  if (config.provider === "waha") {
    const opts = {
      serverUrl: config.serverUrl,
      apiKey: config.apiKey || undefined,
      sessionName: config.sessionName,
    };
    const status = await wahaGetState(opts);
    return {
      ...status,
      state:
        status.state === "open"
          ? "open"
          : status.state === "connecting"
            ? "connecting"
            : "close",
      qrcode:
        status.ok && status.state === "connecting"
          ? await wahaGetQrCode(opts)
          : null,
      phone: status.phone || null,
    };
  }
  const status = await evolutionGetState({
    serverUrl: config.serverUrl,
    apiKey: config.apiKey,
    instanceName: config.sessionName,
  });
  return {
    ...status,
    state:
      status.state === "open"
        ? "open"
        : status.state === "connecting"
          ? "connecting"
          : "close",
    qrcode: null,
    phone: status.phone || null,
  };
}
export async function connectChannel(
  clientId: string,
  origin: string,
): Promise<ChannelStatus> {
  const client = await getClient(clientId);
  if (!client)
    return {
      ok: false,
      state: "close",
      qrcode: null,
      phone: null,
      error: "Cliente não encontrado.",
    };
  const config = await channelConfiguration(clientId);
  if (config.provider === "native") {
    const result = await connectNativeWhatsApp(clientId);
    return { ...result, phone: result.phone || null };
  }
  const webhook =
    origin + "/api/webhook/" + config.provider + "/" + client.webhook_key;
  const result =
    config.provider === "waha"
      ? await wahaCreateOrConnect(
          {
            serverUrl: config.serverUrl,
            apiKey: config.apiKey || undefined,
            sessionName: config.sessionName,
          },
          webhook,
        )
      : await evolutionCreateOrConnect(
          {
            serverUrl: config.serverUrl,
            apiKey: config.apiKey,
            instanceName: config.sessionName,
          },
          webhook,
        );
  return { ...result, phone: result.phone || null };
}
export async function disconnectChannel(
  clientId: string,
): Promise<{ ok: boolean; error?: string }> {
  const config = await channelConfiguration(clientId);
  if (config.provider === "native") return disconnectNativeWhatsApp(clientId);
  if (config.provider === "waha")
    return wahaLogout({
      serverUrl: config.serverUrl,
      apiKey: config.apiKey || undefined,
      sessionName: config.sessionName,
    });
  return evolutionLogout({
    serverUrl: config.serverUrl,
    apiKey: config.apiKey,
    instanceName: config.sessionName,
  });
}

/** Native sessions need one persistent Node process; never start them in serverless. */
export async function resumeSavedNativeChannels(): Promise<void> {
  const clients = await listClients();
  for (const client of clients) {
    const configuration = await channelConfiguration(client.id);
    if (configuration.provider === "native")
      await getNativeWhatsAppStatus(client.id, { reconnect: true });
  }
}
