import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decrypt, encrypt, signSession, verifySession } from "@/lib/crypto";

const fakes = vi.hoisted(() => ({
  online: false,
  settings: new Map<string, string>(),
  jar: new Map<string, string>(),
  writes: [] as Record<string, string>[],
}));

vi.mock("@/lib/store", () => ({
  isOnline: () => fakes.online,
  getSetting: async (key: string) => fakes.settings.get(key) ?? null,
  getOrCreateSetting: async (key: string, value: string) => {
    if (!fakes.settings.has(key)) fakes.settings.set(key, value);
    return fakes.settings.get(key)!;
  },
  setSettings: async (values: Record<string, string>) => {
    fakes.writes.push(values);
    for (const [key, value] of Object.entries(values))
      fakes.settings.set(key, value);
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      fakes.jar.has(name) ? { value: fakes.jar.get(name)! } : undefined,
    set: (name: string, value: string) => fakes.jar.set(name, value),
    delete: (name: string) => fakes.jar.delete(name),
  }),
  headers: async () => new Headers({ "x-forwarded-for": "192.0.2.50" }),
}));

let temporary = "";
const saved = {
  data: process.env.TRACK_DATA_DIR,
  secret: process.env.APP_SECRET,
};

beforeEach(() => {
  vi.resetModules();
  fakes.online = false;
  fakes.settings.clear();
  fakes.jar.clear();
  fakes.writes.length = 0;
  (
    globalThis as { __trackLoginAttempts?: Map<string, unknown> }
  ).__trackLoginAttempts?.clear();
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "track-auth-test-"));
  process.env.TRACK_DATA_DIR = temporary;
  delete process.env.APP_SECRET;
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(temporary, { recursive: true, force: true });
  if (saved.data === undefined) delete process.env.TRACK_DATA_DIR;
  else process.env.TRACK_DATA_DIR = saved.data;
  if (saved.secret === undefined) delete process.env.APP_SECRET;
  else process.env.APP_SECRET = saved.secret;
});

describe("segredos e credenciais", () => {
  for (const online of [false, true]) {
    it(`cadastro inicial concorrente tem um único vencedor (${online ? "online" : "local"})`, async () => {
      fakes.online = online;
      const config = await import("@/lib/config");
      const passwords = ["PrimeiraSenha2026!", "SegundaSenha2026!"];
      const results = await Promise.all(
        passwords.map((password) => config.setInitialPassword(password)),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(
        await config.verifyPassword(passwords[results.indexOf(true)]),
      ).toBe(true);
      expect(
        await config.verifyPassword(passwords[results.indexOf(false)]),
      ).toBe(false);
      expect(await config.setInitialPassword("TentativaPosterior!")).toBe(
        false,
      );
    });
  }
  it("cria segredo exclusivo e respeita APP_SECRET também no modo local", async () => {
    const config = await import("@/lib/config");
    const generated = await config.appSecret();
    expect(generated).toMatch(/^[a-f0-9]{64}$/);
    expect(await config.appSecret()).toBe(generated);
    process.env.APP_SECRET = "a".repeat(64);
    expect(await config.appSecret()).toBe("a".repeat(64));
    expect(
      JSON.parse(fs.readFileSync(path.join(temporary, "config.json"), "utf8"))
        .appSecret,
    ).toBe(generated);
  });

  it("não substitui configuração corrompida por outra chave", async () => {
    fs.writeFileSync(path.join(temporary, "config.json"), "arquivo-incompleto");
    const config = await import("@/lib/config");
    await expect(config.appSecret()).rejects.toThrow();
    expect(fs.readFileSync(path.join(temporary, "config.json"), "utf8")).toBe(
      "arquivo-incompleto",
    );
  });

  it("revoga a sessão na troca de senha sem invalidar tokens AES", async () => {
    const config = await import("@/lib/config");
    await config.setPassword("SenhaInicial2026!");
    const aesKey = await config.appSecret();
    const token = encrypt("token-ficticio", aesKey);
    const oldSession = signSession(
      Date.now() + 60_000,
      (await config.sessionSecret())!,
    );
    await config.setPassword("SenhaNova2026!");
    expect(
      verifySession(oldSession, (await config.sessionSecret())!, Date.now()),
    ).toBe(false);
    expect(decrypt(token, await config.appSecret())).toBe("token-ficticio");
    expect(await config.verifyPassword("SenhaInicial2026!")).toBe(false);
    expect(await config.verifyPassword("SenhaNova2026!")).toBe(true);
  });

  it("salva sal e hash online em uma única configuração atômica", async () => {
    fakes.online = true;
    const config = await import("@/lib/config");
    await config.setPassword("SenhaOnline2026!");
    expect(Object.keys(fakes.writes[0])).toEqual(["auth_credentials"]);
    expect(await config.verifyPassword("SenhaOnline2026!")).toBe(true);
    expect(await config.verifyPassword("Errada")).toBe(false);
  });

  it("chamadas iniciais concorrentes usam o segredo vencedor", async () => {
    fakes.online = true;
    const config = await import("@/lib/config");
    const secrets = await Promise.all(
      Array.from({ length: 12 }, () => config.appSecret()),
    );
    expect(new Set(secrets).size).toBe(1);
    expect(secrets[0]).toBe(fakes.settings.get("app_secret"));
  });

  it("verifica credencial legada e migra para par único ao trocar senha", async () => {
    const local = await import("@/lib/config");
    await local.setPassword("Legada2026!");
    const legacy = JSON.parse(
      fs.readFileSync(path.join(temporary, "config.json"), "utf8"),
    );
    fakes.online = true;
    fakes.settings.set("password_salt", legacy.passwordSalt);
    fakes.settings.set("password_hash", legacy.passwordHash);
    expect(await local.verifyPassword("Legada2026!")).toBe(true);
    await local.setPassword("Migrada2026!");
    expect(await local.verifyPassword("Legada2026!")).toBe(false);
    expect(await local.verifyPassword("Migrada2026!")).toBe(true);
  });
});

describe("sessão e tentativas de acesso", () => {
  it("rejeita cookie com parte extra, assinatura inválida ou prazo expirado", () => {
    const now = Date.now();
    const cookie = signSession(now + 60_000, "segredo-ficticio");
    expect(verifySession(cookie, "segredo-ficticio", now)).toBe(true);
    expect(verifySession(`${cookie}.extra`, "segredo-ficticio", now)).toBe(
      false,
    );
    expect(verifySession(cookie, "outra-chave", now)).toBe(false);
    expect(verifySession(cookie, "segredo-ficticio", now + 120_000)).toBe(
      false,
    );
  });

  it("cookies anteriores à migração não autenticam o painel", async () => {
    const config = await import("@/lib/config");
    await config.setPassword("Senha2026!");
    fakes.jar.set(
      "tm_sessao",
      signSession(Date.now() + 60_000, await config.appSecret()),
    );
    const auth = await import("@/lib/auth");
    expect(await auth.isLoggedIn()).toBe(false);
    await auth.startSession();
    expect(await auth.isLoggedIn()).toBe(true);
    await config.setPassword("Outra2026!");
    expect(await auth.isLoggedIn()).toBe(false);
  });

  it("limita tentativas por origem e libera após a janela", async () => {
    const config = await import("@/lib/config");
    await config.setPassword("Correta2026!");
    const auth = await import("@/lib/auth");
    for (let i = 0; i < 8; i++)
      expect(await auth.login("Incorreta")).toBe(false);
    expect(await auth.login("Correta2026!")).toBe(false);
    const later = Date.now() + 6 * 60_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    expect(await auth.login("Correta2026!")).toBe(true);
    expect(await auth.isLoggedIn()).toBe(true);
  });
});
