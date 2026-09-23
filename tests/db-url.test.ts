import { describe, expect, it } from "vitest";
import { databaseUrlAdvice, describeDatabaseUrl, explainDatabaseError, normalizeDatabaseUrl } from "@/lib/db-url";

const POOLER = "postgresql://postgres.abcdefghijklmnop:Senha123@aws-0-sa-east-1.pooler.supabase.com:6543/postgres";

describe("normalizeDatabaseUrl", () => {
  it("mantém uma URL limpa", () => {
    expect(normalizeDatabaseUrl(POOLER)).toBe(POOLER);
  });

  it("tira os colchetes deixados em volta da senha", () => {
    expect(
      normalizeDatabaseUrl("postgresql://postgres.abcdefghijklmnop:[Senha123]@aws-0-sa-east-1.pooler.supabase.com:6543/postgres"),
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
    const out = normalizeDatabaseUrl("postgresql://user:Se@nh#a*1/2@host.example.com:5432/db");
    expect(out).toBe("postgresql://user:Se%40nh%23a*1%2F2@host.example.com:5432/db");
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
    expect(info?.masked).toBe("postgresql://postgres.abcdefghijklmnop:••••••@aws-0-sa-east-1.pooler.supabase.com:6543/postgres");
    expect(info?.masked).not.toContain("Senha123");
  });

  it("aceita URL sem senha e sem porta", () => {
    expect(describeDatabaseUrl("postgres://u@h/d")).toMatchObject({ user: "u", password: "", host: "h", port: "", database: "d" });
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

  it("reconhece a conexão direta do Supabase e mostra o formato do pooler", () => {
    const advice = databaseUrlAdvice("postgresql://postgres:Senha123@db.abcdefghijklmnop.supabase.co:5432/postgres");
    expect(advice).toMatch(/conexão direta/);
    expect(advice).toContain("postgres.abcdefghijklmnop");
    expect(advice).toContain("pooler.supabase.com:6543");
  });

  it("exige senha só no Supabase; Postgres local pode não ter", () => {
    expect(databaseUrlAdvice("postgresql://postgres@127.0.0.1:5432/trackrun")).toBeNull();
    expect(databaseUrlAdvice("postgresql://postgres.abcdefghijklmnop@aws-0-sa-east-1.pooler.supabase.com:6543/postgres")).toMatch(
      /sem a senha/,
    );
  });

  it("avisa quando o usuário do pooler está sem o código do projeto", () => {
    expect(databaseUrlAdvice("postgresql://postgres:Senha123@aws-0-sa-east-1.pooler.supabase.com:6543/postgres")).toMatch(
      /postgres\.<código do projeto>/,
    );
  });

  it("recusa o que não é URL de Postgres", () => {
    expect(databaseUrlAdvice("https://abc.supabase.co")).toMatch(/postgresql:\/\//);
    expect(databaseUrlAdvice("Senha123")).toMatch(/postgresql:\/\//);
  });
});

describe("explainDatabaseError", () => {
  const err = (message: string, code?: string) => Object.assign(new Error(message), code ? { code } : {});

  it("senha recusada", () => {
    expect(explainDatabaseError(err('password authentication failed for user "postgres"', "28P01"), POOLER)).toMatch(
      /recusou a senha/,
    );
  });

  it("projeto não encontrado no pooler", () => {
    expect(explainDatabaseError(err("Tenant or user not found"), POOLER)).toMatch(/não encontrou o projeto/);
  });

  it("endereço inexistente", () => {
    expect(explainDatabaseError(err("getaddrinfo ENOTFOUND x", "ENOTFOUND"), POOLER)).toMatch(/endereço do banco não existe/);
  });

  it("tempo esgotado sugere projeto pausado", () => {
    expect(explainDatabaseError(err("timeout expired"), POOLER)).toMatch(/pausam/);
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
    expect(fs.readFileSync("supabase-tabelas.sql", "utf8")).toBe(SUPABASE_SETUP_SQL);
  });
});
