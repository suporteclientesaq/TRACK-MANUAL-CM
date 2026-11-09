import "server-only";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { getOrCreateSetting, getSetting, isOnline, setSettings } from "./store";

const derivePassword = promisify(scrypt);
const CREDENTIALS_SETTING = "auth_credentials";

/**
 * Segredo do sistema e senha do painel.
 *  - Modo local:  data/config.json (gerado sozinho na primeira execução).
 *  - Modo online: tabela settings do banco.
 * APP_SECRET no ambiente tem prioridade em ambos os modos. Guarde-o fora do Git
 * e preserve-o ao restaurar um backup: trocar a chave exige recadastrar tokens.
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
  const dir =
    process.env.TRACK_DATA_DIR?.trim() || path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return path.join(dir, "config.json");
}

function readLocal(): Config {
  const file = localFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<Config>;
    if (
      parsed &&
      typeof parsed.appSecret === "string" &&
      parsed.appSecret.length >= 32
    ) {
      return {
        createdAt: new Date().toISOString(),
        ...parsed,
        appSecret: parsed.appSecret,
      };
    }
    throw new Error(
      "A configuração local está inválida. Restaure config.json do backup antes de continuar.",
    );
  } catch (error) {
    // Não substituir uma chave ilegível: os tokens existentes precisam dela.
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  const fresh: Config = {
    appSecret: randomBytes(32).toString("hex"),
    createdAt: new Date().toISOString(),
  };
  try {
    // Criação exclusiva também protege a primeira execução em dois processos.
    fs.writeFileSync(file, JSON.stringify(fresh, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST")
      return readLocal();
    throw error;
  }
  return fresh;
}

function writeLocal(cfg: Config): void {
  const file = localFile();
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// ---- modo online -------------------------------------------------------------

async function readOnline(): Promise<Config> {
  const [secret, salt, hash, credentials, created] = await Promise.all([
    getSetting("app_secret"),
    getSetting("password_salt"),
    getSetting("password_hash"),
    getSetting(CREDENTIALS_SETTING),
    getSetting("created_at"),
  ]);
  let appSecretValue = configuredSecret() || secret || "";
  if (!appSecretValue) {
    appSecretValue = await getOrCreateSetting(
      "app_secret",
      randomBytes(32).toString("hex"),
    );
  }
  const credential = credentials ? parseCredentials(credentials) : null;
  return {
    appSecret: appSecretValue,
    passwordSalt: credential?.salt || salt || undefined,
    passwordHash: credential?.hash || hash || undefined,
    createdAt: created || new Date().toISOString(),
  };
}

function configuredSecret(): string | null {
  const secret = process.env.APP_SECRET?.trim();
  if (!secret) return null;
  if (secret.length < 32)
    throw new Error(
      "APP_SECRET precisa ter pelo menos 32 caracteres aleatórios.",
    );
  return secret;
}

function parseCredentials(value: string): { salt: string; hash: string } {
  const parsed: unknown = JSON.parse(value);
  if (
    parsed &&
    typeof parsed === "object" &&
    "salt" in parsed &&
    "hash" in parsed &&
    typeof parsed.salt === "string" &&
    /^[a-f0-9]{32}$/i.test(parsed.salt) &&
    typeof parsed.hash === "string" &&
    /^[a-f0-9]{128}$/i.test(parsed.hash)
  ) {
    return { salt: parsed.salt, hash: parsed.hash };
  }
  throw new Error(
    "A credencial salva está inválida. Restaure a configuração de acesso.",
  );
}

// ---- API --------------------------------------------------------------------

async function read(): Promise<Config> {
  const local = isOnline() ? await readOnline() : readLocal();
  const config = { ...local, appSecret: configuredSecret() || local.appSecret };
  // Fingerprint of the runtime secret accidentally published in the old tree.
  // Never accept it again, even when an old data volume is restored.
  const fingerprint = createHash("sha256")
    .update(config.appSecret)
    .digest("hex");
  if (
    fingerprint ===
    "52997e2fc6127ee02f23b18b2a7f435e11edca40edb561a59c2e98473646aee1"
  ) {
    throw new Error(
      "O segredo desta instalação foi exposto em uma versão antiga. Preserve um backup, defina um APP_SECRET novo e recadastre os tokens dos clientes. As sessões antigas precisam ser revogadas.",
    );
  }
  return config;
}

/** Segredo que assina o login e criptografa os tokens do Meta. */
export async function appSecret(): Promise<string> {
  return (await read()).appSecret;
}

/** Trocar a senha revoga cookies, sem trocar a chave AES dos tokens do Meta. */
export async function sessionSecret(): Promise<string | null> {
  const config = await read();
  if (!config.passwordSalt || !config.passwordHash) return null;
  return createHash("sha256")
    .update(
      `session-v2:${config.appSecret}:${config.passwordSalt}:${config.passwordHash}`,
    )
    .digest("hex");
}

export async function hasPassword(): Promise<boolean> {
  const c = await read();
  return !!(c.passwordHash && c.passwordSalt);
}

export async function setPassword(password: string): Promise<void> {
  if (password.length < 6 || password.length > 1024)
    throw new Error("Use uma senha entre 6 e 1024 caracteres.");
  const salt = randomBytes(16).toString("hex");
  const hash = ((await derivePassword(password, salt, 64)) as Buffer).toString(
    "hex",
  );
  if (isOnline()) {
    // Uma linha, um commit: sal e hash nunca pertencem a senhas diferentes.
    await setSettings({
      [CREDENTIALS_SETTING]: JSON.stringify({ salt, hash }),
    });
  } else {
    writeLocal({ ...readLocal(), passwordSalt: salt, passwordHash: hash });
  }
}

/** Only one bootstrap request may establish the first credential. */
export async function setInitialPassword(password: string): Promise<boolean> {
  if (password.length < 6 || password.length > 1024)
    throw new Error("Use uma senha entre 6 e 1024 caracteres.");
  if (await hasPassword()) return false;
  if (isOnline()) {
    const salt = randomBytes(16).toString("hex");
    const hash = (
      (await derivePassword(password, salt, 64)) as Buffer
    ).toString("hex");
    const candidate = JSON.stringify({ salt, hash });
    return (
      (await getOrCreateSetting(CREDENTIALS_SETTING, candidate)) === candidate
    );
  }
  const lockPath = `${localFile()}.setup-lock`;
  let lock: number;
  try {
    lock = fs.openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST")
      return false;
    throw error;
  }
  try {
    if (await hasPassword()) return false;
    await setPassword(password);
    return true;
  } finally {
    fs.closeSync(lock);
    fs.rmSync(lockPath, { force: true });
  }
}

export async function verifyPassword(password: string): Promise<boolean> {
  if (password.length > 1024) return false;
  const c = await read();
  if (!c.passwordHash || !c.passwordSalt) return false;
  const given = (await derivePassword(password, c.passwordSalt, 64)) as Buffer;
  const expected = Buffer.from(c.passwordHash, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function configPath(): string | null {
  return isOnline() ? null : localFile();
}
