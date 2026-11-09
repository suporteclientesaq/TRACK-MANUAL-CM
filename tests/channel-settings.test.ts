import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
let dir: string;
let store: typeof import("@/lib/store");
let channels: typeof import("@/lib/channels");
let first: string;
let second: string;
const keys = [
  "TRACK_DATA_DIR",
  "DATABASE_URL",
  "SUPABASE_DATABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "APP_SECRET",
  "WAHA_SERVER_URL",
  "WAHA_API_KEY",
  "WAHA_CLIENT_ID",
  "WAHA_SESSION_NAME",
];
let saved: Record<string, string | undefined>;
beforeAll(async () => {
  saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "track-channel-"));
  process.env.TRACK_DATA_DIR = dir;
  store = await import("@/lib/store");
  channels = await import("@/lib/channels");
  first = await store.insertClient({ name: "Canal A" });
}, 60_000);
afterAll(() => {
  try {
    (globalThis as any).__trackDb?.close?.();
    delete (globalThis as any).__trackDb;
    delete (globalThis as any).__trackDbPath;
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
  for (const k of keys) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
describe("vinculação da VPS e proteção da chave", () => {
  it("usa ambiente com sessão default e não entrega a chave ao navegador", async () => {
    process.env.WAHA_SERVER_URL = "https://waha.example.test/api/";
    process.env.WAHA_API_KEY = "fixture-private-key";
    const config = await channels.channelConfiguration(first);
    expect(config).toMatchObject({
      provider: "waha",
      sessionName: "default",
      serverUrl: "https://waha.example.test",
      apiKey: "fixture-private-key",
      managedByEnvironment: true,
    });
    const pub = await channels.publicChannelConfiguration(first);
    expect(pub.hasApiKey).toBe(true);
    expect(JSON.stringify(pub)).not.toContain("fixture-private-key");
  });
  it("não associa silenciosamente a sessão default a várias empresas", async () => {
    second = await store.insertClient({ name: "Canal B" });
    expect((await channels.channelConfiguration(second)).provider).toBe(
      "native",
    );
    process.env.WAHA_CLIENT_ID = first;
    expect((await channels.channelConfiguration(first)).provider).toBe("waha");
    expect((await channels.channelConfiguration(second)).provider).toBe(
      "native",
    );
  });
  it("salva vínculo de ambiente sem copiar a chave para o banco", async () => {
    await channels.saveChannelConfiguration(first, {
      provider: "waha",
      useServerDefaults: true,
    });
    const row = (await store.getSetting("whatsapp_config_" + first))!;
    expect(row).toContain("useServerDefaults");
    expect(row).not.toContain("fixture-private-key");
  });
  it("impede a mesma sessão em duas empresas", async () => {
    await expect(
      channels.saveChannelConfiguration(second, {
        provider: "waha",
        serverUrl: "https://waha.example.test",
        sessionName: "default",
        apiKey: "fixture-key",
      }),
    ).rejects.toThrow(/outra empresa/);
  });
  it("cifra a configuração manual e exige chave ao mudar de servidor", async () => {
    await channels.saveChannelConfiguration(second, {
      provider: "waha",
      serverUrl: "https://second.example.test",
      sessionName: "default",
      apiKey: "key-only-second",
    });
    expect(
      (await store.getSetting("whatsapp_config_" + second))!,
    ).not.toContain("key-only-second");
    await expect(
      channels.saveChannelConfiguration(second, {
        provider: "waha",
        serverUrl: "https://third.example.test",
        sessionName: "default",
      }),
    ).rejects.toThrow(/novo servidor/);
  });
  it("permite recadastrar uma chave corrompida sem derrubar a página", async () => {
    await store.setSettings({
      ["whatsapp_config_" + second]: JSON.stringify({
        provider: "waha",
        serverUrl: "https://second.example.test",
        sessionName: "default",
        apiKeyEnc: "invalid-ciphertext",
      }),
    });
    const pub = await channels.publicChannelConfiguration(second);
    expect(pub.configurationError).toMatch(/Recadastre/);
    expect(pub.hasApiKey).toBe(false);
    await channels.saveChannelConfiguration(second, {
      provider: "waha",
      serverUrl: "https://second.example.test",
      sessionName: "default",
      apiKey: "repaired-key",
    });
    expect((await channels.channelConfiguration(second)).apiKey).toBe(
      "repaired-key",
    );
  });
  it("verifica conflito também ao usar a configuração do ambiente", async () => {
    const previousUrl = process.env.WAHA_SERVER_URL;
    process.env.WAHA_SERVER_URL = "https://second.example.test";
    try {
      await expect(
        channels.saveChannelConfiguration(first, {
          provider: "waha",
          useServerDefaults: true,
        }),
      ).rejects.toThrow(/outra empresa/);
    } finally {
      process.env.WAHA_SERVER_URL = previousUrl;
    }
  });
});
