import { describe, expect, it } from "vitest";
import {
  databaseUrlAdvice,
  describeDatabaseUrl,
  explainDatabaseError,
  isSupabaseDatabase,
  normalizeDatabaseUrl,
} from "@/lib/db-url";

const POOLER =
  "postgresql://postgres.abcdefghijklmnop:Senha123@aws-0-sa-east-1.pooler.supabase.com:6543/postgres";

describe("normalizeDatabaseUrl", () => {
  it("mantém uma URL limpa", () => {
    expect(normalizeDatabaseUrl(POOLER)).toBe(POOLER);
  });

  it("tira os colchetes deixados em volta da senha", () => {
    expect(
      normalizeDatabaseUrl(
        "postgresql://postgres.abcdefghijklmnop:[Senha123]@aws-0-sa-east-1.pooler.supabase.com:6543/postgres",
      ),
    ).toBe(POOLER);
  });

  it("tira espaços, quebras de linha e aspas", () => {
    expect(
      normalizeDatabaseUrl(
        ' "postgresql://postgres.abcdefghijklmnop: Senha123 @aws-0-sa-east-1.pooler.supabase.com:6543/postgres"\n',
      ),
    ).toBe(POOLER);
  });

  it("aceita o valor colado com o nome da variável na frente", () => {
    expect(normalizeDatabaseUrl(`DATABASE_URL=${POOLER}`)).toBe(POOLER);
  });

  it("codifica símbolos da senha que quebrariam a URL", () => {
    const out = normalizeDatabaseUrl(
      "postgresql://user:Se@nh#a*1/2@host.example.com:5432/db",
    );
    expect(out).toBe(
      "postgresql://user:Se%40nh%23a*1%2F2@host.example.com:5432/db",
    );
    expect(describeDatabaseUrl(out)?.password).toBe("Se@nh#a*1/2");
    expect(describeDatabaseUrl(out)?.host).toBe("host.example.com");
  });

  it("não codifica duas vezes uma senha já codificada", () => {
    const url = "postgresql://user:Se%40nha@host.example.com:5432/db";
    expect(normalizeDatabaseUrl(url)).toBe(url);
  });

  it("devolve vazio para vazio", () => {
    expect(normalizeDatabaseUrl(undefined)).toBe("");
    expect(normalizeDatabaseUrl("   ")).toBe("");
  });
});

describe("describeDatabaseUrl", () => {
  it("separa as partes e esconde a senha", () => {
    const info = describeDatabaseUrl(POOLER);
    expect(info).toMatchObject({
      user: "postgres.abcdefghijklmnop",
      password: "Senha123",
      host: "aws-0-sa-east-1.pooler.supabase.com",
      port: "6543",
      database: "postgres",
    });
    expect(info?.masked).toBe(
      "postgresql://postgres.abcdefghijklmnop:••••••@aws-0-sa-east-1.pooler.supabase.com:6543/postgres",
    );
    expect(info?.masked).not.toContain("Senha123");
  });

  it("aceita URL sem senha e sem porta", () => {
    expect(describeDatabaseUrl("postgres://u@h/d")).toMatchObject({
      user: "u",
      password: "",
      host: "h",
      port: "",
      database: "d",
    });
  });
});

describe("databaseUrlAdvice", () => {
  it("aprova a URI do pooler", () => {
    expect(databaseUrlAdvice(POOLER)).toBeNull();
  });

  it("aponta o [YOUR-PASSWORD] esquecido", () => {
    const url = normalizeDatabaseUrl(
      "postgresql://postgres.abcdefghijklmnop:[YOUR-PASSWORD]@aws-0-sa-east-1.pooler.supabase.com:6543/postgres",
    );
    expect(databaseUrlAdvice(url)).toMatch(/YOUR-PASSWORD/);
  });

  it("permite tentar uma conexão direta válida, inclusive com IPv4 add-on", () => {
    expect(
      databaseUrlAdvice(
        "postgresql://postgres:Senha123@db.abcdefghijklmnop.supabase.co:5432/postgres",
      ),
    ).toBeNull();
  });

  it("exige senha só no Supabase; Postgres local pode não ter", () => {
    expect(
      databaseUrlAdvice("postgresql://postgres@127.0.0.1:5432/trackrun"),
    ).toBeNull();
    expect(
      databaseUrlAdvice(
        "postgresql://postgres.abcdefghijklmnop@aws-0-sa-east-1.pooler.supabase.com:6543/postgres",
      ),
    ).toMatch(/sem a senha/);
  });

  it("avisa quando o usuário do pooler está sem o código do projeto", () => {
    expect(
      databaseUrlAdvice(
        "postgresql://postgres:Senha123@aws-0-sa-east-1.pooler.supabase.com:6543/postgres",
      ),
    ).toMatch(/postgres\.<código do projeto>/);
  });

  it("recusa o que não é URL de Postgres", () => {
    expect(databaseUrlAdvice("https://abc.supabase.co")).toMatch(
      /postgresql:\/\//,
    );
    expect(databaseUrlAdvice("Senha123")).toMatch(/postgresql:\/\//);
  });
});

describe("explainDatabaseError", () => {
  const err = (message: string, code?: string) =>
    Object.assign(new Error(message), code ? { code } : {});

  it("senha recusada", () => {
    expect(
      explainDatabaseError(
        err('password authentication failed for user "postgres"', "28P01"),
        POOLER,
      ),
    ).toMatch(/recusou a senha/);
  });

  it("projeto não encontrado no pooler", () => {
    expect(
      explainDatabaseError(err("Tenant or user not found"), POOLER),
    ).toMatch(/não encontrou o projeto/);
  });

  it("endereço inexistente", () => {
    expect(
      explainDatabaseError(err("getaddrinfo ENOTFOUND x", "ENOTFOUND"), POOLER),
    ).toMatch(/endereço do banco não existe/);
  });

  it("tempo esgotado sugere projeto pausado", () => {
    expect(explainDatabaseError(err("timeout expired"), POOLER)).toMatch(
      /pausados/,
    );
  });

  it("caso genérico repete a mensagem e o endereço", () => {
    const out = explainDatabaseError(err("algo estranho"), POOLER);
    expect(out).toContain("algo estranho");
    expect(out).toContain("aws-0-sa-east-1.pooler.supabase.com:6543");
    expect(out).not.toContain("Senha123");
  });
});

describe("supabase-tabelas.sql", () => {
  it("é o mesmo SQL que a tela mostra", async () => {
    const fs = await import("node:fs");
    const { SUPABASE_SETUP_SQL } = await import("@/lib/schema-sql");
    expect(fs.readFileSync("supabase-tabelas.sql", "utf8")).toBe(
      SUPABASE_SETUP_SQL,
    );
  });
});

describe("provedor e SSL", () => {
  const custom =
    "postgresql://usr:PrivatePassword123@db.yousecure.io:5437/customdb?access_token=query-secret";
  const error = (message: string, code?: string) =>
    Object.assign(new Error(message), { code });

  it("classifica pelo host real e reconhece Supabase REST e pooler", () => {
    expect(isSupabaseDatabase(custom)).toBe(false);
    expect(isSupabaseDatabase(POOLER)).toBe(true);
    expect(isSupabaseDatabase("https://project.supabase.co")).toBe(true);
    expect(
      isSupabaseDatabase(
        "postgresql://u:p@db.supabase.co.attacker.test:5432/db",
      ),
    ).toBe(false);
  });

  it("orienta CA oficial para o host/porta recebidos, sem sugerir outro provedor", () => {
    const message = explainDatabaseError(
      error("self-signed certificate", "DEPTH_ZERO_SELF_SIGNED_CERT"),
      custom,
    );
    expect(message).toContain("db.yousecure.io:5437");
    expect(message).toContain("DATABASE_SSL_CA");
    expect(message).toContain("CA oficial");
    expect(message).not.toMatch(
      /Supabase|pooler|6543|rejectUnauthorized.*false|NODE_TLS_REJECT_UNAUTHORIZED.*0/,
    );
    expect(message).not.toContain("PrivatePassword123");
    expect(message).not.toContain("query-secret");
  });

  it.each(["28P01", "ECONNREFUSED", "ETIMEDOUT", "ENETUNREACH", "3D000"])(
    "não presume Supabase no erro %s",
    (code) => {
      const message = explainDatabaseError(error("falha", code), custom);
      expect(message).not.toMatch(/Supabase|supabase|pooler|6543/);
    },
  );

  it("diferencia nome inválido de CA não confiável", () => {
    const message = explainDatabaseError(
      error(
        "Hostname/IP does not match certificate's altnames",
        "ERR_TLS_CERT_ALTNAME_INVALID",
      ),
      custom,
    );
    expect(message).toContain("nome no certificado");
    expect(message).not.toContain("DATABASE_SSL_CA");
  });

  it("diferencia certificado expirado", () => {
    expect(
      explainDatabaseError(
        error("certificate has expired", "CERT_HAS_EXPIRED"),
        custom,
      ),
    ).toContain("expirou");
  });

  it("redige URL e credenciais repetidas por um erro de driver", () => {
    const message = explainDatabaseError(
      error(
        `connection failed: ${custom} password=PrivatePassword123 access_token=query-secret`,
      ),
      custom,
    );
    expect(message).toContain("db.yousecure.io:5437");
    expect(message).not.toContain("PrivatePassword123");
    expect(message).not.toContain("query-secret");
    expect(message).not.toContain("access_token=query-secret");
  });

  it("redige credencial em erro de permissão também", () => {
    expect(
      explainDatabaseError(
        error("permission denied password=PrivatePassword123", "42501"),
        custom,
      ),
    ).not.toContain("PrivatePassword123");
  });
});
