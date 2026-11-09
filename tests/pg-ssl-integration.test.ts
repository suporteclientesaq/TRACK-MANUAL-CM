import { describe, expect, it } from "vitest";
import { Pool, type PoolConfig } from "pg";
import { buildPgConnectionOptions } from "@/lib/pg-connection";

// Opt in only against a disposable PostgreSQL server using a private test CA.
// These tests perform SELECT statements only; they do not create/drop schemas.
const databaseUrl = process.env.TEST_SSL_DATABASE_URL;
const certificate = process.env.TEST_SSL_DATABASE_CA;
const enabled = Boolean(databaseUrl && certificate);

async function query(config: PoolConfig) {
  const pool = new Pool({ ...config, max: 1, connectionTimeoutMillis: 5_000 });
  try {
    return await pool.query<{ answer: number; ssl: boolean; version: string }>(
      "select 1::int as answer, ssl, version from pg_stat_ssl where pid = pg_backend_pid()",
    );
  } finally {
    await pool.end();
  }
}

describe.skipIf(!enabled)("PostgreSQL real com CA privada (opt-in)", () => {
  it("recusa a cadeia privada quando a CA não foi configurada", async () => {
    const { config } = buildPgConnectionOptions(databaseUrl!, {});
    await expect(query(config)).rejects.toMatchObject({
      code: expect.stringMatching(/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/),
    });
  });

  it("executa SELECT 1 com certificado validado e TLS ativo", async () => {
    const { config } = buildPgConnectionOptions(databaseUrl!, {
      DATABASE_SSL_CA: certificate!,
    });
    const result = await query(config);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ answer: 1, ssl: true });
    expect(result.rows[0].version).toMatch(/^TLSv1\.[23]$/);
  });

  it("continua recusando um hostname diferente do certificado", async () => {
    const { config } = buildPgConnectionOptions(databaseUrl!, {
      DATABASE_SSL_CA: certificate!,
    });
    config.ssl = {
      ...(typeof config.ssl === "object" ? config.ssl : {}),
      servername: "wrong-hostname.invalid",
    };
    await expect(query(config)).rejects.toMatchObject({
      code: "ERR_TLS_CERT_ALTNAME_INVALID",
    });
  });
});
