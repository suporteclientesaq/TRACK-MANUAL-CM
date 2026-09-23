import "server-only";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getSetting, isOnline, setSettings } from "./store";

/**
 * Segredo do sistema e senha do painel.
 *  - Modo local:  data/config.json (gerado sozinho na primeira execução).
 *  - Modo online: tabela settings do banco. APP_SECRET no ambiente, se existir,
 *    tem prioridade sobre o segredo do banco.
 * A senha nunca é guardada: só o hash (scrypt) com um sal aleatório.
 */

interface Config {
  appSecret: string;
  passwordSalt?: string;
  passwordHash?: string;
  createdAt: string;
}

// ---- modo local -------------------------------------------------------------

function localFile(): string {
  const dir = process.env.TRACK_DATA_DIR?.trim() || path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "config.json");
}

function readLocal(): Config {
  try {
    const parsed = JSON.parse(fs.readFileSync(localFile(), "utf8")) as Partial<Config>;
    if (parsed && typeof parsed.appSecret === "string" && parsed.appSecret.length >= 32) {
      return { createdAt: new Date().toISOString(), ...parsed, appSecret: parsed.appSecret };
    }
  } catch {
    // ainda não existe ou está ilegível: cria abaixo
  }
  const fresh: Config = { appSecret: randomBytes(32).toString("hex"), createdAt: new Date().toISOString() };
  writeLocal(fresh);
  return fresh;
}

function writeLocal(cfg: Config): void {
  const tmp = `${localFile()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, localFile());
}

// ---- modo online -------------------------------------------------------------

async function readOnline(): Promise<Config> {
  const [secret, salt, hash, created] = await Promise.all([
    getSetting("app_secret"),
    getSetting("password_salt"),
    getSetting("password_hash"),
    getSetting("created_at"),
  ]);
  let appSecretValue = (process.env.APP_SECRET || "").trim() || secret || "";
  if (!appSecretValue) {
    appSecretValue = randomBytes(32).toString("hex");
    await setSettings({ app_secret: appSecretValue, created_at: new Date().toISOString() });
  }
  return {
    appSecret: appSecretValue,
    passwordSalt: salt || undefined,
    passwordHash: hash || undefined,
    createdAt: created || new Date().toISOString(),
  };
}

// ---- API --------------------------------------------------------------------

async function read(): Promise<Config> {
  return isOnline() ? readOnline() : readLocal();
}

/** Segredo que assina o login e criptografa os tokens do Meta. */
export async function appSecret(): Promise<string> {
  return (await read()).appSecret;
}

export async function hasPassword(): Promise<boolean> {
  const c = await read();
  return !!(c.passwordHash && c.passwordSalt);
}

export async function setPassword(password: string): Promise<void> {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  if (isOnline()) {
    await setSettings({ password_salt: salt, password_hash: hash });
  } else {
    writeLocal({ ...readLocal(), passwordSalt: salt, passwordHash: hash });
  }
}

export async function verifyPassword(password: string): Promise<boolean> {
  const c = await read();
  if (!c.passwordHash || !c.passwordSalt) return false;
  const given = scryptSync(password, c.passwordSalt, 64);
  const expected = Buffer.from(c.passwordHash, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function configPath(): string | null {
  return isOnline() ? null : localFile();
}
