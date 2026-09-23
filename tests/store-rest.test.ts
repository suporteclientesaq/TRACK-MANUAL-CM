import { afterEach, describe, expect, it } from "vitest";
import { RestError, explainRestError, keyRole, restConfig } from "@/lib/store-rest";

const jwt = (role: string) => {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "HS256", typ: "JWT" })}.${b({ iss: "supabase", role })}.assinatura`;
};

describe("restConfig", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of ["SUPABASE_DATABASE_URL", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY"]) {
      delete process.env[k];
      if (saved[k] !== undefined) process.env[k] = saved[k];
    }
  });

  it("monta a base /rest/v1 para projetos do Supabase", () => {
    process.env.SUPABASE_DATABASE_URL = "https://ysmybjardvietcurpxkh.supabase.co/";
    process.env.SUPABASE_SERVICE_ROLE_KEY = jwt("service_role");
    expect(restConfig()).toEqual({
      url: "https://ysmybjardvietcurpxkh.supabase.co",
      base: "https://ysmybjardvietcurpxkh.supabase.co/rest/v1",
      key: jwt("service_role"),
    });
  });

  it("usa o endereço como está quando não é supabase.co (PostgREST próprio)", () => {
    process.env.SUPABASE_URL = "http://127.0.0.1:54402";
    process.env.SUPABASE_SERVICE_KEY = "x";
    expect(restConfig()?.base).toBe("http://127.0.0.1:54402");
  });

  it("ignora quando falta a chave ou o endereço não é http", () => {
    process.env.SUPABASE_DATABASE_URL = "https://abc.supabase.co";
    expect(restConfig()).toBeNull();
    process.env.SUPABASE_SERVICE_ROLE_KEY = "x";
    process.env.SUPABASE_DATABASE_URL = "postgresql://postgres@db.abc.supabase.co:5432/postgres";
    expect(restConfig()).toBeNull();
  });
});

describe("keyRole", () => {
  it("reconhece as chaves antigas pelo papel dentro do JWT e as novas pelo prefixo", () => {
    expect(keyRole(jwt("service_role"))).toBe("service_role");
    expect(keyRole(jwt("anon"))).toBe("anon");
    expect(keyRole("sb_secret_abc")).toBe("secret");
    expect(keyRole("sb_publishable_abc")).toBe("publishable");
    expect(keyRole("qualquer-coisa")).toBe("unknown");
    expect(keyRole("a.b.c")).toBe("unknown");
  });
});

describe("explainRestError", () => {
  const c = { url: "https://abc.supabase.co", base: "https://abc.supabase.co/rest/v1", key: "k" };

  it("tabela fora do cache pede o SQL", () => {
    expect(explainRestError(new RestError(404, { code: "PGRST205", message: "Could not find the table 'public.settings' in the schema cache" }, ""), c)).toBe(
      "TABELAS_FALTANDO"
    );
  });

  it("chave recusada", () => {
    expect(explainRestError(new RestError(401, { message: "No suitable key or wrong key type" }, ""), c)).toMatch(/recusou a chave/);
  });

  it("endereço inexistente", () => {
    const e = Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    expect(explainRestError(e, c)).toMatch(/abc\.supabase\.co não existe/);
  });

  it("tempo esgotado", () => {
    const e = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    expect(explainRestError(e, c)).toMatch(/não respondeu/);
  });
});
