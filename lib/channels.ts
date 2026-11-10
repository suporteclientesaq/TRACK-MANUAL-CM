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
  wahaQr,
  normalizeWahaUrl,
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
  managedByEnvironment?: boolean;
}
export interface PublicChannelConfiguration {
  provider: ChannelProvider;
  serverUrl: string;
  sessionName: string;
  hasApiKey: boolean;
  serverDefaultsAvailable?: boolean;
  configurationError?: string;
  managedByEnvironment?: boolean;
}
export interface ChannelStatus {
  ok: boolean;
  state: "open" | "connecting" | "close";
  qrcode: string | null;
  phone: string | null;
  error?: string;
  providerStatus?: string;
}
const provider = (value: unknown): ChannelProvider =>
  value === "waha" || value === "evolution" ? value : "native";

async function environmentWaha(
  clientId: string,
): Promise<ChannelConfiguration | null> {
  if (!process.env.WAHA_SERVER_URL?.trim()) return null;
  const owner = process.env.WAHA_CLIENT_ID?.trim();
  if (owner ? owner !== clientId : (await listClients()).length !== 1)
    return null;
  return {
    provider: "waha",
    serverUrl: normalizeWahaUrl(process.env.WAHA_SERVER_URL),
    sessionName: process.env.WAHA_SESSION_NAME?.trim() || "default",
    apiKey: process.env.WAHA_API_KEY?.trim() || "",
    managedByEnvironment: true,
  };
}

export async function channelConfiguration(
  clientId: string,
): Promise<ChannelConfiguration> {
  const raw = await getSetting("whatsapp_config_" + clientId);
  if (!raw)
    return (
      (await environmentWaha(clientId)) || {
        provider: "native",
        serverUrl: "",
        sessionName: "track_" + clientId.replaceAll("-", "").slice(0, 16),
        apiKey: "",
      }
    );
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.useServerDefaults === true) {
      const defaults = await environmentWaha(clientId);
      if (!defaults)
        throw new Error(
          "Confira WAHA_SERVER_URL e WAHA_CLIENT_ID no ambiente do Track Manual.",
        );
      return defaults;
    }
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
  try {
    const { apiKey, ...config } = await channelConfiguration(clientId);
    return {
      ...config,
      hasApiKey: !!apiKey,
      serverDefaultsAvailable: !!(await environmentWaha(clientId)),
    };
  } catch {
    let raw: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(
        (await getSetting("whatsapp_config_" + clientId)) || "{}",
      );
      if (parsed && typeof parsed === "object") raw = parsed;
    } catch {}
    let available = false;
    try {
      available = !!(await environmentWaha(clientId));
    } catch {}
    return {
      provider: provider(raw.provider),
      serverUrl: typeof raw.serverUrl === "string" ? raw.serverUrl : "",
      sessionName:
        typeof raw.sessionName === "string" ? raw.sessionName : "default",
      hasApiKey: false,
      serverDefaultsAvailable: available,
      configurationError:
        "A chave salva não pôde ser lida. Recadastre a chave do canal ou use a configuração da VPS no servidor.",
    };
  }
}
async function assertWahaSessionAvailable(
  clientId: string,
  candidate: Pick<ChannelConfiguration, "serverUrl" | "sessionName">,
): Promise<void> {
  for (const other of await listClients()) {
    if (other.id === clientId) continue;
    const config = await publicChannelConfiguration(other.id);
    if (
      config.provider === "waha" &&
      config.serverUrl === candidate.serverUrl &&
      config.sessionName === candidate.sessionName
    )
      throw new Error(
        "Esta sessão WAHA já está vinculada a outra empresa. Use uma sessão/instalação separada para não misturar conversas.",
      );
  }
}
export async function saveChannelConfiguration(
  clientId: string,
  input: {
    provider: unknown;
    serverUrl?: string;
    sessionName?: string;
    apiKey?: string;
    useServerDefaults?: boolean;
  },
  validateOnly = false,
): Promise<ChannelConfiguration> {
  if (!(await getClient(clientId))) throw new Error("Cliente não encontrado.");
  if (!["native", "waha", "evolution"].includes(String(input.provider)))
    throw new Error("Selecione um provedor válido.");
  let existing: ChannelConfiguration;
  try {
    existing = await channelConfiguration(clientId);
  } catch {
    if (!input.apiKey?.trim() && !input.useServerDefaults)
      throw new Error(
        "Recadastre a chave de acesso do WAHA/Evolution para recuperar esta configuração.",
      );
    existing = {
      provider: "native",
      serverUrl: "",
      sessionName: "default",
      apiKey: "",
    };
  }
  if (input.useServerDefaults && input.provider === "waha") {
    const defaults = await environmentWaha(clientId);
    if (!defaults)
      throw new Error(
        "Configure WAHA_SERVER_URL e, se houver várias empresas, WAHA_CLIENT_ID no servidor do Track Manual.",
      );
    await assertWahaSessionAvailable(clientId, defaults);
    if (!validateOnly)
      await setSettings({
        ["whatsapp_config_" + clientId]: JSON.stringify({
          provider: "waha",
          useServerDefaults: true,
        }),
        ["whatsapp_provider_" + clientId]: "waha",
      });
    return defaults;
  }
  const selected = provider(input.provider);
  const sessionName = (
    input.sessionName ||
    (selected === "waha" && existing.provider !== "waha"
      ? "default"
      : existing.sessionName)
  ).trim();
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
    serverUrl =
      selected === "waha"
        ? normalizeWahaUrl(url.toString())
        : url.toString().replace(/\/$/, "");
  }
  const apiKey =
    input.apiKey?.trim() ||
    (existing.provider === selected && existing.serverUrl === serverUrl
      ? existing.apiKey
      : "");
  if (apiKey.length > 4096) throw new Error("Chave de acesso inválida.");
  if (selected === "evolution" && !apiKey)
    throw new Error("Informe a chave de acesso da Evolution.");
  if (selected === "waha") {
    await assertWahaSessionAvailable(clientId, { serverUrl, sessionName });
    if (
      existing.serverUrl &&
      existing.serverUrl !== serverUrl &&
      existing.apiKey &&
      !input.apiKey?.trim()
    )
      throw new Error(
        "Informe a chave do novo servidor. A chave da VPS anterior não é enviada para outro endereço.",
      );
  }
  const apiKeyEnc = apiKey ? encrypt(apiKey, await appSecret()) : "";
  if (!validateOnly)
    await setSettings({
      ["whatsapp_config_" + clientId]: JSON.stringify({
        provider: selected,
        serverUrl,
        sessionName,
        apiKeyEnc,
      }),
      ["whatsapp_provider_" + clientId]: selected,
    });
  return { provider: selected, serverUrl, sessionName, apiKey };
}
export async function channelStatus(
  clientId: string,
  { includeQr = true } = {},
): Promise<ChannelStatus> {
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
    const qr =
      includeQr && status.ok && status.providerStatus === "SCAN_QR_CODE"
        ? await wahaQr(opts)
        : { qrcode: null };
    return {
      ok: status.ok && !qr.error,
      error:
        status.error ||
        qr.error ||
        (status.state === "not_found"
          ? "A sessão ainda não existe no WAHA. Clique em Salvar e conectar para iniciá-la."
          : undefined),
      providerStatus: status.providerStatus,
      state:
        status.state === "open"
          ? "open"
          : status.state === "connecting"
            ? "connecting"
            : "close",
      qrcode: qr.qrcode,
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
  if (
    config.provider === "waha" &&
    config.serverUrl.replace(/\/$/, "") === origin.replace(/\/$/, "")
  )
    return {
      ok: false,
      state: "close",
      qrcode: null,
      phone: null,
      error:
        "Informe o endereço do WAHA na VPS, não o endereço do Track Manual.",
    };
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
