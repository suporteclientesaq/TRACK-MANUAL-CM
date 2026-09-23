import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/** Deriva uma chave de 32 bytes a partir do APP_SECRET, separada por finalidade. */
function key(secret: string, purpose: string): Buffer {
  return createHash("sha256").update(`${purpose}:${secret}`).digest();
}

/** Criptografa um texto (AES-256-GCM). Formato: v1.iv.tag.dados em base64url. */
export function encrypt(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret, "tokens"), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv, tag, data]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

export function decrypt(enc: string, secret: string): string {
  const [version, iv, tag, data] = enc.split(".");
  if (version !== "v1" || !iv || !tag || !data) {
    throw new Error("Token salvo em formato desconhecido. Cadastre o token de novo.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(secret, "tokens"),
    Buffer.from(iv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(data, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error(
      "Não foi possível ler o token salvo. O APP_SECRET mudou? Cadastre o token de novo."
    );
  }
}

/** Cria o valor do cookie de sessão: validade + assinatura. */
export function signSession(expiresAtMs: number, secret: string): string {
  const body = String(expiresAtMs);
  const sig = createHmac("sha256", key(secret, "sessao")).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySession(cookie: string | undefined, secret: string, nowMs: number): boolean {
  if (!cookie) return false;
  const [body, sig] = cookie.split(".");
  if (!body || !sig) return false;
  const expected = createHmac("sha256", key(secret, "sessao")).update(body).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return false;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  const expires = Number(body);
  return Number.isFinite(expires) && expires > nowMs;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
