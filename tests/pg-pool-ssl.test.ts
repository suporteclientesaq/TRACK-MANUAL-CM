import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  key: "trust-A",
  ca: "CA-A",
  failure: "",
  pools: [] as {
    config: Record<string, unknown>;
    query: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  }[],
}));
vi.mock("@/lib/pg-connection", () => ({
  buildPgConnectionOptions: () => {
    if (mock.failure) throw new Error(mock.failure);
    return {
      cacheKey: mock.key,
      config: {
        host: "db.example.test",
        port: 5437,
        user: "fixture",
        password: "fixture-only",
        database: "fixture",
        ssl: { ca: mock.ca, rejectUnauthorized: true },
      },
    };
  },
}));
vi.mock("pg", () => ({
  Pool: class {
    config: Record<string, unknown>;
    query = vi.fn(async () => ({ rows: [] }));
    end = vi.fn(async () => {});
    constructor(config: Record<string, unknown>) {
      this.config = config;
      mock.pools.push(this);
    }
  },
}));
const saved = process.env.DATABASE_URL;
const cache = globalThis as unknown as Record<string, unknown>;
beforeEach(() => {
  vi.resetModules();
  mock.key = "trust-A";
  mock.ca = "CA-A";
  mock.failure = "";
  mock.pools = [];
  process.env.DATABASE_URL =
    "postgresql://fixture:fixture-only@db.example.test:5437/fixture";
  for (const key of [
    "__trackPool",
    "__trackPoolKey",
    "__trackPoolUrl",
    "__trackSchema",
    "__trackCheck",
  ])
    delete cache[key];
});
afterEach(() => {
  if (saved === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = saved;
  for (const key of [
    "__trackPool",
    "__trackPoolKey",
    "__trackSchema",
    "__trackCheck",
  ])
    delete cache[key];
});
describe("pool e diagnóstico acompanham a configuração SSL", () => {
  it("passa SSL explícito para pg sem connectionString que substitua a CA", async () => {
    const { checkConnection } = await import("@/lib/store-pg");
    expect(await checkConnection()).toBeNull();
    expect(mock.pools[0].config.ssl).toEqual({
      ca: "CA-A",
      rejectUnauthorized: true,
    });
    expect(mock.pools[0].config.connectionString).toBeUndefined();
    expect(mock.pools[0].query).toHaveBeenCalledWith("select 1");
  });
  it("reutiliza o sucesso até a CA mudar e recria o pool quando a confiança muda", async () => {
    const { checkConnection } = await import("@/lib/store-pg");
    await checkConnection();
    await checkConnection();
    expect(mock.pools).toHaveLength(1);
    expect(mock.pools[0].query).toHaveBeenCalledTimes(2);
    mock.key = "trust-B";
    mock.ca = "CA-B";
    expect(await checkConnection()).toBeNull();
    expect(mock.pools).toHaveLength(2);
    expect(mock.pools[0].end).toHaveBeenCalledOnce();
    expect(mock.pools[1].config.ssl).toEqual({
      ca: "CA-B",
      rejectUnauthorized: true,
    });
    expect(mock.pools[1].query).toHaveBeenCalledWith("select 1");
  });
  it("não aceita sucesso antigo quando a configuração da CA fica inválida", async () => {
    const { checkConnection } = await import("@/lib/store-pg");
    await checkConnection();
    mock.failure = "DATABASE_SSL_CA não contém um certificado PEM válido.";
    expect(await checkConnection()).toContain("DATABASE_SSL_CA");
    expect(mock.pools).toHaveLength(1);
  });
});
