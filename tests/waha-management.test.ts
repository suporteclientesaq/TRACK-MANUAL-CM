import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  wahaCreateOrConnect,
  wahaGetState,
  wahaQr,
  normalizeWahaUrl,
} from "@/lib/waha";
const config = {
  serverUrl: "https://waha.example.test",
  apiKey: "fixture-api-key",
  sessionName: "default",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
let network: ReturnType<typeof vi.fn>;
beforeEach(() => {
  network = vi.fn();
  vi.stubGlobal("fetch", network);
});
afterEach(() => vi.unstubAllGlobals());
describe("WAHA sessions and QR", () => {
  it("normaliza a URL de API e rejeita segredo na URL", () => {
    expect(normalizeWahaUrl("https://waha.example.test/api/")).toBe(
      config.serverUrl,
    );
    expect(() => normalizeWahaUrl("https://user:secret@waha.test")).toThrow();
  });
  it("mostra formato oficial mimetype/data como imagem", async () => {
    network.mockResolvedValue(
      json({ mimetype: "image/png", data: "aGVsbG8=" }),
    );
    expect((await wahaQr(config)).qrcode).toBe(
      "data:image/png;base64,aGVsbG8=",
    );
  });
  it("aceita resposta binária de imagem", async () => {
    network.mockResolvedValue(
      new Response("image-bytes", { headers: { "Content-Type": "image/png" } }),
    );
    expect((await wahaQr(config)).qrcode).toBe(
      "data:image/png;base64,aW1hZ2UtYnl0ZXM=",
    );
  });
  it("converte valor QR bruto para uma imagem escaneável", async () => {
    network.mockResolvedValue(
      json({ value: "fixture-whatsapp-pairing-content" }),
    );
    expect((await wahaQr(config)).qrcode).toMatch(/^data:image\/png;base64,/);
  });
  it("não usa HTML ou URL arbitrária como QR", async () => {
    network.mockResolvedValue(json({ image: "https://other.example/qr.png" }));
    expect((await wahaQr(config)).qrcode).toBeNull();
    network.mockResolvedValue(new Response("<html>login</html>"));
    expect((await wahaQr(config)).qrcode).toBeNull();
  });
  it("expõe erros reais do endpoint de QR", async () => {
    network.mockResolvedValueOnce(json({ message: "Not Found" }, 404));
    expect(await wahaQr(config)).toMatchObject({
      qrcode: null,
      error: expect.stringContaining("HTTP 404"),
    });
    network.mockResolvedValueOnce(json({ message: "Engine not supported" }, 422));
    expect(await wahaQr(config)).toMatchObject({
      qrcode: null,
      error: expect.stringContaining("Engine not supported"),
    });
  });
  it("aguarda nova consulta se o WAHA mudou de estado antes de entregar o QR", async () => {
    network.mockResolvedValue(
      json({ status: "WORKING", expected: ["SCAN_QR_CODE"] }, 422),
    );
    expect(await wahaQr(config)).toEqual({ qrcode: null });
  });
  it("não tenta criar ou iniciar uma sessão quando a chave falha", async () => {
    network.mockResolvedValue(json({ message: "Unauthorized" }, 401));
    const result = await wahaCreateOrConnect(config);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/chave/);
    expect(network).toHaveBeenCalledTimes(1);
  });
  it("não confunde um painel HTML com sessão ausente", async () => {
    network.mockResolvedValue(
      new Response("<html>Dashboard</html>", { status: 404 }),
    );
    expect((await wahaCreateOrConnect(config)).ok).toBe(false);
    expect(network).toHaveBeenCalledTimes(1);
  });
  it("não cria sessão quando um proxy devolve um 404 genérico", async () => {
    network.mockResolvedValue(json({ message: "Not Found" }, 404));
    expect(await wahaCreateOrConnect(config)).toMatchObject({
      ok: false,
      error: expect.stringContaining("HTTP 404"),
    });
    expect(network).toHaveBeenCalledTimes(1);
  });
  it("erro ao iniciar não vira sucesso conectando", async () => {
    network
      .mockResolvedValueOnce(json({ status: "STOPPED" }))
      .mockResolvedValueOnce(json({ message: "engine unavailable" }, 500));
    expect((await wahaCreateOrConnect(config)).ok).toBe(false);
    expect(network).toHaveBeenCalledTimes(2);
  });
  it("cria a sessão e deixa STARTING para polling sem QR falso", async () => {
    network
      .mockResolvedValueOnce(json({ message: "Session not found" }, 404))
      .mockResolvedValueOnce(json({ name: "default" }, 201))
      .mockResolvedValueOnce(json({ status: "STARTING" }));
    const result = await wahaCreateOrConnect(config);
    expect(result).toMatchObject({
      ok: true,
      state: "connecting",
      qrcode: null,
    });
    expect(JSON.parse(network.mock.calls[1][1].body).name).toBe("default");
  });
  it("reinicia FAILED apenas por ação explícita", async () => {
    network
      .mockResolvedValueOnce(json({ status: "FAILED" }))
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(json({ status: "SCAN_QR_CODE" }))
      .mockResolvedValueOnce(json({ mimetype: "image/png", data: "aGVsbG8=" }));
    expect((await wahaCreateOrConnect(config)).qrcode).toBeTruthy();
    expect(network.mock.calls[1][0]).toContain("/default/restart");
  });
  it("usa PUT documentado e preserva configuração e webhooks alheios", async () => {
    network
      .mockResolvedValueOnce(
        json({
          status: "WORKING",
          me: { id: "5511999999999@c.us" },
          config: {
            proxy: { server: "proxy" },
            webhooks: [
              { url: "https://crm.example/hook", events: ["message"] },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(
        json({ status: "WORKING", me: { id: "5511999999999@c.us" } }),
      );
    expect(
      (
        await wahaCreateOrConnect(
          config,
          "https://track.example/api/webhook/waha/key",
        )
      ).state,
    ).toBe("open");
    expect(network.mock.calls[1][1].method).toBe("PUT");
    const body = JSON.parse(network.mock.calls[1][1].body);
    expect(body.config.proxy).toEqual({ server: "proxy" });
    expect(body.config.webhooks).toHaveLength(2);
  });
  it("preserva o QR em andamento quando o webhook já está configurado", async () => {
    const webhook = "https://track.example/api/webhook/waha/key";
    const state = {
      status: "SCAN_QR_CODE",
      config: { webhooks: [{ url: webhook, events: ["message", "session.status"] }] },
    };
    network
      .mockResolvedValueOnce(json(state))
      .mockResolvedValueOnce(json(state))
      .mockResolvedValueOnce(json({ mimetype: "image/png", data: "aGVsbG8=" }));
    expect(await wahaCreateOrConnect(config, webhook)).toMatchObject({
      ok: true,
      state: "connecting",
      qrcode: "data:image/png;base64,aGVsbG8=",
    });
    expect(network.mock.calls.every(([, options]) => !options.method)).toBe(true);
  });
  it("consulta de estado nunca inicia sessão ou pede QR prematuro", async () => {
    network.mockResolvedValue(json({ status: "STARTING" }));
    expect((await wahaGetState(config)).state).toBe("connecting");
    expect(network.mock.calls[0][1].method).toBeUndefined();
  });
  it("exibe diagnóstico Core/default sem vazar chave", async () => {
    network
      .mockResolvedValueOnce(json({ message: "Session not found" }, 404))
      .mockResolvedValueOnce(
        json(
          { message: "CORE only default session allowed fixture-api-key" },
          422,
        ),
      );
    const result = await wahaCreateOrConnect({
      ...config,
      sessionName: "other",
    });
    expect(result.error).toMatch(/Core.*default/);
    expect(result.error).not.toContain(config.apiKey);
  });
  it("não converte estado inválido ou passkey em conexão funcionando", async () => {
    network.mockResolvedValue(json({ status: "PASSKEY_REQUIRED" }));
    expect((await wahaGetState(config)).ok).toBe(false);
  });
});
