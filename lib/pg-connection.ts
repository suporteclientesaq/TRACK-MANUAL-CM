import "server-only";
import { createHash, X509Certificate } from "node:crypto";
import fs from "node:fs";
import { isIP } from "node:net";
import { createSecureContext, type ConnectionOptions } from "node:tls";
import type { PoolConfig } from "pg";
import { parseIntoClientConfig } from "pg-connection-string";

export interface PgConnectionEnvironment {
  DATABASE_SSL_CA?: string;
  DATABASE_SSL_CA_BASE64?: string;
  PGSSLMODE?: string;
}

export interface PgConnectionOptions {
  config: PoolConfig;
  /** Fingerprint only: never log a connection URL, password or client key. */
  cacheKey: string;
}

const SSL_PARAMETERS = [
  "ssl",
  "sslmode",
  "sslrootcert",
  "sslcert",
  "sslkey",
  "uselibpqcompat",
] as const;
const SSL_MODES = new Set([
  "disable",
  "no-verify",
  "verify-full",
  "verify-ca",
  "require",
  "prefer",
  "allow",
]);

function certificateBundle(value: string, source: string): string {
  const pem = value
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .trim();
  const certificates =
    pem.match(
      /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
    ) || [];
  const remainder = certificates
    .reduce((text, certificate) => text.replace(certificate, ""), pem)
    .trim();
  try {
    if (!certificates.length || remainder || pem.length > 1_048_576)
      throw new Error();
    for (const certificate of certificates) new X509Certificate(certificate);
  } catch {
    throw new Error(
      `${source} não contém um certificado CA válido em formato PEM. Use o certificado oficial fornecido pelo provedor do banco.`,
    );
  }
  return certificates.join("\n") + "\n";
}

function readTlsFile(file: string, parameter: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    throw new Error(
      `Não foi possível ler o arquivo indicado em ${parameter}. Confira se ele existe e está acessível no servidor.`,
    );
  }
}

/**
 * Parse the URI once and pass explicit pg fields to Pool. pg otherwise parses
 * connectionString again and replaces ssl, discarding an explicitly supplied CA.
 * Verification stays enabled unless the operator explicitly requested otherwise.
 */
export function buildPgConnectionOptions(
  url: string,
  environment: PgConnectionEnvironment = {
    DATABASE_SSL_CA: process.env.DATABASE_SSL_CA,
    DATABASE_SSL_CA_BASE64: process.env.DATABASE_SSL_CA_BASE64,
    PGSSLMODE: process.env.PGSSLMODE,
  },
): PgConnectionOptions {
  let parsed: URL;
  try {
    parsed = new URL(url);
    if (!/^postgres(ql)?:$/.test(parsed.protocol)) throw new Error();
  } catch {
    throw new Error(
      "DATABASE_URL inválida. Informe a URI PostgreSQL fornecida pelo provedor do banco.",
    );
  }
  const parameter = (name: string) =>
    parsed.searchParams.getAll(name).at(-1)?.trim() || "";
  const requestedSsl = parameter("ssl");
  const requestedMode =
    parameter("sslmode") ||
    (!requestedSsl ? environment.PGSSLMODE?.trim() : "") ||
    "";
  if (requestedMode && !SSL_MODES.has(requestedMode)) {
    throw new Error(
      "Modo SSL inválido. Use sslmode=verify-full para validar o certificado e o servidor do banco.",
    );
  }
  if (
    requestedSsl &&
    !["0", "1", "false", "true", "no-verify"].includes(requestedSsl)
  ) {
    throw new Error(
      "Parâmetro ssl inválido na DATABASE_URL. Use sslmode=verify-full.",
    );
  }
  const rootFile = parameter("sslrootcert");
  const certFile = parameter("sslcert");
  const keyFile = parameter("sslkey");
  const direct = parameter("sslnegotiation") === "direct";
  if (
    parameter("uselibpqcompat") === "true" &&
    requestedMode &&
    !["verify-full", "disable", "no-verify"].includes(requestedMode)
  ) {
    throw new Error(
      "A compatibilidade libpq altera a validação SSL. Use sslmode=verify-full com o certificado CA do provedor; não reduza a verificação automaticamente.",
    );
  }
  for (const name of SSL_PARAMETERS) parsed.searchParams.delete(name);
  // An arbitrary query field must not cause pg to reparse a second URI.
  parsed.searchParams.delete("connectionString");
  let config: PoolConfig;
  try {
    config = parseIntoClientConfig(parsed.toString());
  } catch {
    throw new Error(
      "DATABASE_URL inválida. Confira usuário, porta e nome do banco na URI do provedor.",
    );
  }
  delete config.connectionString;
  const host = String(config.host || "").replace(/^\[|\]$/g, "");
  config.host = host;
  const local =
    !host ||
    host === "localhost" ||
    host === "::1" ||
    (isIP(host) === 4 && host.startsWith("127.")) ||
    host.startsWith("/");

  const pemValue = environment.DATABASE_SSL_CA?.trim();
  const base64Value = environment.DATABASE_SSL_CA_BASE64?.trim();
  if (pemValue && base64Value) {
    throw new Error(
      "Configure apenas uma entre DATABASE_SSL_CA e DATABASE_SSL_CA_BASE64.",
    );
  }
  if ((pemValue || base64Value) && rootFile) {
    throw new Error(
      "Configure o certificado CA em DATABASE_SSL_CA/DATABASE_SSL_CA_BASE64 ou em sslrootcert, sem combinar as duas fontes.",
    );
  }
  let ca: string | undefined;
  if (pemValue) ca = certificateBundle(pemValue, "DATABASE_SSL_CA");
  if (base64Value) {
    const base64 = base64Value.replace(/\s/g, "");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) {
      throw new Error(
        "DATABASE_SSL_CA_BASE64 inválida. Codifique o certificado CA PEM completo em base64.",
      );
    }
    ca = certificateBundle(
      Buffer.from(base64, "base64").toString("utf8"),
      "DATABASE_SSL_CA_BASE64",
    );
  }
  if (rootFile)
    ca = certificateBundle(readTlsFile(rootFile, "sslrootcert"), "sslrootcert");
  if (!!certFile !== !!keyFile) {
    throw new Error(
      "Para autenticação TLS por certificado, informe sslcert e sslkey juntos.",
    );
  }
  const explicitDisabled =
    requestedMode === "disable" ||
    (!requestedMode && ["0", "false"].includes(requestedSsl));
  const explicitNoVerify =
    requestedMode === "no-verify" ||
    (!requestedMode && requestedSsl === "no-verify");
  if ((explicitDisabled || explicitNoVerify) && (ca || certFile || keyFile)) {
    throw new Error(
      "Há certificados configurados junto de um modo SSL sem verificação. Use sslmode=verify-full para validar o certificado do banco.",
    );
  }
  if (explicitDisabled && direct) {
    throw new Error(
      "sslnegotiation=direct exige TLS. Remova sslmode=disable ou desative a negociação direta.",
    );
  }
  const enabled =
    !explicitDisabled &&
    (!!requestedMode ||
      ["1", "true", "no-verify"].includes(requestedSsl) ||
      !!ca ||
      !!certFile ||
      direct ||
      !local);
  if (!enabled) config.ssl = false;
  else {
    const ssl: ConnectionOptions = {
      rejectUnauthorized: !explicitNoVerify,
      ...(ca ? { ca } : {}),
    };
    if (certFile && keyFile) {
      ssl.cert = readTlsFile(certFile, "sslcert");
      ssl.key = readTlsFile(keyFile, "sslkey");
    }
    try {
      createSecureContext(ssl);
    } catch {
      throw new Error(
        "Não foi possível configurar os certificados SSL do banco. Confira o certificado CA e o par sslcert/sslkey, se utilizado.",
      );
    }
    config.ssl = ssl;
  }
  // Include resolved certificate contents: rotating a CA or client certificate
  // at the same file path must invalidate the pool and cached connection error.
  const cacheKey = createHash("sha256")
    .update(JSON.stringify(config))
    .digest("hex");
  return { config, cacheKey };
}
