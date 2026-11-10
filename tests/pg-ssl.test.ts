import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import tls, { type ConnectionOptions } from "node:tls";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPgConnectionOptions } from "@/lib/pg-connection";
import { YOUSECURE_POSTGRES_CA } from "@/lib/yousecure-postgres-ca";

let directory: string;
let ca: string;
let anotherCa: string;
let key: string;
let certificate: string;
let server: tls.Server;
let port: number;
const remote =
  "postgresql://operator:S%40nha%2F123@db.example.test:5437/track?application_name=Track%20Manual";
const openssl = (...args: string[]) =>
  execFileSync("openssl", args, { cwd: directory, stdio: "ignore" });

let hasOpenSsl = false;
try {
  execFileSync("openssl", ["version"], { stdio: "ignore" });
  hasOpenSsl = true;
} catch {}

beforeAll(async () => {
  if (!hasOpenSsl) return;
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "track-postgres-tls-"));
  for (const name of ["ca", "other-ca"]) {
    openssl(
      "req",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:prime256v1",
      "-nodes",
      "-keyout",
      `${name}.key`,
      "-out",
      `${name}.crt`,
      "-days",
      "2",
      "-subj",
      `/CN=Track Test ${name}`,
      "-addext",
      "basicConstraints=critical,CA:TRUE",
    );
  }
  openssl(
    "req",
    "-new",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:prime256v1",
    "-nodes",
    "-keyout",
    "server.key",
    "-out",
    "server.csr",
    "-subj",
    "/CN=localhost",
  );
  fs.writeFileSync(
    path.join(directory, "server.ext"),
    "subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyAgreement\nextendedKeyUsage=serverAuth\n",
  );
  openssl(
    "x509",
    "-req",
    "-in",
    "server.csr",
    "-CA",
    "ca.crt",
    "-CAkey",
    "ca.key",
    "-CAcreateserial",
    "-out",
    "server.crt",
    "-days",
    "2",
    "-extfile",
    "server.ext",
  );
  ca = fs.readFileSync(path.join(directory, "ca.crt"), "utf8");
  anotherCa = fs.readFileSync(path.join(directory, "other-ca.crt"), "utf8");
  certificate = fs.readFileSync(path.join(directory, "server.crt"), "utf8");
  key = fs.readFileSync(path.join(directory, "server.key"), "utf8");
  server = tls.createServer({ key, cert: certificate }, (socket) => {
    socket.on("error", () => {});
    socket.end();
  });
  server.on("tlsClientError", () => {});
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  if (directory) {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
    } catch {}
  }
});

function handshake(
  ssl: ConnectionOptions,
  servername = "localhost",
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ ...ssl, host: "127.0.0.1", port, servername });
    socket.setTimeout(3_000, () =>
      socket.destroy(new Error("TLS test timeout")),
    );
    socket.once("secureConnect", () => {
      socket.end();
      resolve();
    });
    socket.once("error", (error) => {
      socket.destroy();
      reject(error);
    });
  });
}

describe("configuração SSL do Postgres", () => {
  it("valida o servidor remoto e preserva credenciais/porta sem reparse de connectionString", () => {
    const { config, cacheKey } = buildPgConnectionOptions(remote, {});
    expect(config).toMatchObject({
      host: "db.example.test",
      port: 5437,
      database: "track",
      user: "operator",
      password: "S@nha/123",
      application_name: "Track Manual",
      ssl: { rejectUnauthorized: true },
    });
    expect(config.connectionString).toBeUndefined();
    expect(cacheKey).toMatch(/^[a-f0-9]{64}$/);
    expect(cacheKey).not.toContain("S@nha");
  });

  it("mantém CA explícita quando o pg recebe sslmode=require", () => {
    if (!hasOpenSsl) return;
    const { config } = buildPgConnectionOptions(remote + "&sslmode=require", {
      DATABASE_SSL_CA: ca,
    });
    const client = new Client(config);
    const actual = (
      client as unknown as { connectionParameters: { ssl: ConnectionOptions } }
    ).connectionParameters.ssl;
    expect(actual.ca).toBe(ca);
    expect(actual.rejectUnauthorized).toBe(true);
    expect(config).not.toHaveProperty("sslmode");
  });

  it("suporta PEM com quebras literais e base64 sem baixar certificados da rede", () => {
    if (!hasOpenSsl) return;
    expect(
      buildPgConnectionOptions(remote, {
        DATABASE_SSL_CA: ca.replace(/\n/g, "\\n"),
      }).config.ssl,
    ).toEqual({ rejectUnauthorized: true, ca });
    expect(
      buildPgConnectionOptions(remote, {
        DATABASE_SSL_CA_BASE64: Buffer.from(ca).toString("base64"),
      }).config.ssl,
    ).toEqual({ rejectUnauthorized: true, ca });
  });

  it("recusa CA inválida, chave privada no campo CA e fontes conflitantes", () => {
    if (!hasOpenSsl) return;
    expect(() =>
      buildPgConnectionOptions(remote, {
        DATABASE_SSL_CA: "not a certificate",
      }),
    ).toThrow(/certificado CA válido/);
    expect(() =>
      buildPgConnectionOptions(remote, { DATABASE_SSL_CA: key }),
    ).toThrow(/certificado CA válido/);
    expect(() =>
      buildPgConnectionOptions(remote, {
        DATABASE_SSL_CA_BASE64: "bad-base64!",
      }),
    ).toThrow(/BASE64 inválida/);
    expect(() =>
      buildPgConnectionOptions(remote, {
        DATABASE_SSL_CA: ca,
        DATABASE_SSL_CA_BASE64: Buffer.from(ca).toString("base64"),
      }),
    ).toThrow(/apenas uma/);
    expect(() =>
      buildPgConnectionOptions(remote + "&sslrootcert=not-used", {
        DATABASE_SSL_CA: ca,
      }),
    ).toThrow(/sem combinar/);
  });

  it("respeita sslrootcert e certificados de cliente presentes na URI", () => {
    if (!hasOpenSsl) return;
    const uri = new URL(remote);
    for (const [name, file] of [
      ["sslrootcert", "ca.crt"],
      ["sslcert", "server.crt"],
      ["sslkey", "server.key"],
    ])
      uri.searchParams.set(name, path.join(directory, file));
    expect(buildPgConnectionOptions(uri.toString(), {}).config.ssl).toEqual({
      rejectUnauthorized: true,
      ca,
      cert: certificate,
      key,
    });
    uri.searchParams.set("sslrootcert", path.join(directory, "missing.crt"));
    expect(() => buildPgConnectionOptions(uri.toString(), {})).toThrow(
      /arquivo indicado em sslrootcert/,
    );
  });

  it("não ignora um par de certificado/chave incompleto", () => {
    if (!hasOpenSsl) return;
    const uri = new URL(remote);
    uri.searchParams.set("sslcert", path.join(directory, "server.crt"));
    expect(() => buildPgConnectionOptions(uri.toString(), {})).toThrow(
      /sslcert e sslkey juntos/,
    );
  });

  it("local não usa TLS por padrão, mas respeita o pedido explícito e IPv6", () => {
    expect(
      buildPgConnectionOptions("postgres://u:p@localhost:5432/db", {}).config
        .ssl,
    ).toBe(false);
    expect(
      buildPgConnectionOptions("postgres://u:p@[::1]:5432/db", {}).config,
    ).toMatchObject({ host: "::1", ssl: false });
    expect(
      buildPgConnectionOptions(
        "postgres://u:p@localhost:5432/db?sslmode=verify-full",
        {},
      ).config.ssl,
    ).toEqual({ rejectUnauthorized: true });
    if (!hasOpenSsl) return;
    expect(
      buildPgConnectionOptions("postgres://u:p@localhost:5432/db", {
        DATABASE_SSL_CA: ca,
      }).config.ssl,
    ).toEqual({ rejectUnauthorized: true, ca });
  });

  it("usa o host efetivo do driver para decidir TLS e preserva parâmetros não SSL", () => {
    const config = buildPgConnectionOptions(
      "postgres://u:p@localhost:5432/db?host=remote.example.test&port=5437&options=-c%20statement_timeout%3D3000",
      {},
    ).config;
    expect(config).toMatchObject({
      host: "remote.example.test",
      port: 5437,
      options: "-c statement_timeout=3000",
      ssl: { rejectUnauthorized: true },
    });
  });

  it("aplica o certificado da You Secure somente ao endpoint PostgreSQL validado", () => {
    const uri = "postgresql://u:p@db.yousecure.io:5437/track";
    expect(
      buildPgConnectionOptions(uri + "?sslmode=require", {}).config.ssl,
    ).toEqual({ rejectUnauthorized: true, ca: YOUSECURE_POSTGRES_CA });
    for (const differentEndpoint of [
      uri.replace("5437", "5432"),
      uri.replace("db.yousecure.io", "db.other.example"),
    ]) {
      expect(buildPgConnectionOptions(differentEndpoint, {}).config.ssl).toEqual({
        rejectUnauthorized: true,
      });
    }
  });

  it("prioriza a CA configurada pelo operador sobre o certificado da You Secure", () => {
    if (!hasOpenSsl) return;
    expect(
      buildPgConnectionOptions("postgresql://u:p@db.yousecure.io:5437/track", {
        DATABASE_SSL_CA: ca,
      }).config.ssl,
    ).toEqual({ rejectUnauthorized: true, ca });
  });

  it("não reduz verificação por require/prefer/allow/verify-ca", () => {
    for (const mode of [
      "require",
      "prefer",
      "allow",
      "verify-ca",
      "verify-full",
    ])
      expect(
        buildPgConnectionOptions(remote + "&sslmode=" + mode, {}).config.ssl,
      ).toEqual({ rejectUnauthorized: true });
    expect(() =>
      buildPgConnectionOptions(
        remote + "&sslmode=require&uselibpqcompat=true",
        {},
      ),
    ).toThrow(/compatibilidade libpq/);
  });

  it("desativa ou reduz TLS apenas quando solicitado explicitamente, sem mascarar CA configurada", () => {
    expect(
      buildPgConnectionOptions(remote + "&sslmode=disable", {}).config.ssl,
    ).toBe(false);
    expect(
      buildPgConnectionOptions(remote + "&sslmode=no-verify", {}).config.ssl,
    ).toEqual({ rejectUnauthorized: false });
    if (!hasOpenSsl) return;
    expect(() =>
      buildPgConnectionOptions(remote + "&sslmode=no-verify", {
        DATABASE_SSL_CA: ca,
      }),
    ).toThrow(/modo SSL sem verificação/);
    expect(() =>
      buildPgConnectionOptions(remote + "&sslmode=disable", {
        DATABASE_SSL_CA: ca,
      }),
    ).toThrow(/modo SSL sem verificação/);
  });

  it("respeita PGSSLMODE quando a URI não configura SSL", () => {
    expect(
      buildPgConnectionOptions("postgres://u:p@localhost/db", {
        PGSSLMODE: "verify-full",
      }).config.ssl,
    ).toEqual({ rejectUnauthorized: true });
    expect(
      buildPgConnectionOptions(remote + "&ssl=false", {
        PGSSLMODE: "verify-full",
      }).config.ssl,
    ).toBe(false);
  });

  it("invalida a identidade do pool ao trocar a CA ou a senha e não expõe material", () => {
    if (!hasOpenSsl) return;
    const first = buildPgConnectionOptions(remote, { DATABASE_SSL_CA: ca });
    expect(
      buildPgConnectionOptions(remote, { DATABASE_SSL_CA: ca }).cacheKey,
    ).toBe(first.cacheKey);
    expect(
      buildPgConnectionOptions(remote, { DATABASE_SSL_CA: anotherCa }).cacheKey,
    ).not.toBe(first.cacheKey);
    expect(
      buildPgConnectionOptions(remote.replace("S%40nha%2F123", "another"), {
        DATABASE_SSL_CA: ca,
      }).cacheKey,
    ).not.toBe(first.cacheKey);
    expect(first.cacheKey).not.toContain("CERTIFICATE");
  });

  it("rejeita modos inválidos e negociação direta sem TLS", () => {
    expect(() =>
      buildPgConnectionOptions(remote + "&sslmode=unknown", {}),
    ).toThrow(/Modo SSL inválido/);
    expect(() => buildPgConnectionOptions(remote + "&ssl=unknown", {})).toThrow(
      /Parâmetro ssl inválido/,
    );
    expect(() =>
      buildPgConnectionOptions(
        remote + "&sslmode=disable&sslnegotiation=direct",
        {},
      ),
    ).toThrow(/exige TLS/);
  });
});

describe("handshake TLS real com uma autoridade privada de teste", () => {
  it("recusa o certificado sem a CA confiável", async () => {
    if (!hasOpenSsl) return;
    const { config } = buildPgConnectionOptions(remote, {});
    await expect(handshake(config.ssl as ConnectionOptions)).rejects.toThrow(
      /certificate|verify/i,
    );
  });

  it("aceita o certificado somente com a CA correta e o hostname válido", async () => {
    if (!hasOpenSsl) return;
    const { config } = buildPgConnectionOptions(remote + "&sslmode=require", {
      DATABASE_SSL_CA: ca,
    });
    await expect(
      handshake(config.ssl as ConnectionOptions),
    ).resolves.toBeUndefined();
  });

  it("a CA correta não dispensa a validação do nome do servidor", async () => {
    if (!hasOpenSsl) return;
    const { config } = buildPgConnectionOptions(remote, {
      DATABASE_SSL_CA: ca,
    });
    await expect(
      handshake(config.ssl as ConnectionOptions, "another.example.test"),
    ).rejects.toMatchObject({ code: "ERR_TLS_CERT_ALTNAME_INVALID" });
  });
});
