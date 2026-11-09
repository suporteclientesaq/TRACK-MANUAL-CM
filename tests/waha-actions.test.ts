import { beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  save: vi.fn(),
  probe: vi.fn(),
  connect: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireAuth: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({ host: "track.example", "x-forwarded-proto": "https" }),
}));
vi.mock("@/lib/store", () => ({ getClient: async () => ({ id: "c" }) }));
vi.mock("@/lib/channels", () => ({
  saveChannelConfiguration: fake.save,
  connectChannel: fake.connect,
  channelStatus: vi.fn(),
  disconnectChannel: vi.fn(),
}));
vi.mock("@/lib/waha", () => ({ wahaGetState: fake.probe }));
import { configureAndConnectChannelAction } from "@/app/channel-actions";
beforeEach(() => {
  vi.clearAllMocks();
  fake.save.mockResolvedValue({
    provider: "waha",
    serverUrl: "https://waha.example",
    sessionName: "default",
    apiKey: "test-key",
  });
  fake.probe.mockResolvedValue({ ok: true, state: "not_found" });
  fake.connect.mockResolvedValue({
    ok: true,
    state: "connecting",
    qrcode: null,
  });
});
const input = {
  provider: "waha" as const,
  serverUrl: "https://waha.example",
  sessionName: "default",
  apiKey: "test-key",
};
describe("prévia de credenciais WAHA", () => {
  it("falha de autenticação preserva configuração anterior sem conectar", async () => {
    fake.probe.mockResolvedValue({
      ok: false,
      state: "close",
      error: "Chave recusada",
      configuration: { secret: "must-not-return" },
    });
    const r = await configureAndConnectChannelAction("c", input);
    expect(r.ok).toBe(false);
    expect(fake.save).toHaveBeenCalledTimes(1);
    expect(fake.save).toHaveBeenCalledWith("c", input, true);
    expect(fake.connect).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain("must-not-return");
  });
  it("salva e conecta só após validar o endereço e a autenticação", async () => {
    expect((await configureAndConnectChannelAction("c", input)).ok).toBe(true);
    expect(fake.save).toHaveBeenCalledTimes(2);
    expect(fake.connect).toHaveBeenCalledWith("c", "https://track.example");
  });
  it("outros provedores não são consultados como WAHA", async () => {
    fake.save.mockResolvedValue({ provider: "native" });
    await configureAndConnectChannelAction("c", {
      ...input,
      provider: "native",
    });
    expect(fake.probe).not.toHaveBeenCalled();
  });
});
