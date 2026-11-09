import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  loggedIn: false,
  status: vi.fn(async () => ({
    ok: true,
    state: "close",
    phone: null,
    name: null,
    qrcode: null,
  })),
  connect: vi.fn(async () => ({
    ok: true,
    state: "connecting",
    qrcode: "data:image/png;base64,dGVzdA==",
  })),
  disconnect: vi.fn(async () => undefined),
}));
vi.mock("@/lib/auth", () => ({ isLoggedIn: async () => fakes.loggedIn }));
vi.mock("@/lib/store", () => ({
  listClients: async () => [
    { id: "client-a", name: "Cliente A" },
    { id: "client-b", name: "Cliente B" },
  ],
}));
vi.mock("@/lib/whatsapp-baileys", () => ({
  getNativeWhatsAppStatus: fakes.status,
  connectNativeWhatsApp: fakes.connect,
  disconnectNativeWhatsApp: fakes.disconnect,
}));

const savedKey = process.env.TRACK_WAHA_API_KEY;
beforeEach(() => {
  fakes.loggedIn = false;
  vi.clearAllMocks();
  delete process.env.TRACK_WAHA_API_KEY;
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.TRACK_WAHA_API_KEY;
  else process.env.TRACK_WAHA_API_KEY = savedKey;
});

const ctx = (session: string) => ({ params: Promise.resolve({ session }) });
const request = (method = "GET", body?: object) =>
  new NextRequest("http://localhost/api/waha/api/sessions/client-a", {
    method,
    ...(body
      ? {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
        }
      : {}),
  });

describe("controle de acesso da API WAHA", () => {
  it("nega GET, POST, DELETE e QR anônimos sem acessar sessões", async () => {
    const routes = await import("@/app/api/waha/api/sessions/[session]/route");
    const qr = await import("@/app/api/waha/api/[session]/auth/qr/route");
    expect((await routes.GET(request(), ctx("client-a"))).status).toBe(401);
    expect((await routes.POST(request("POST"), ctx("client-a"))).status).toBe(
      401,
    );
    expect(
      (await routes.DELETE(request("DELETE"), ctx("client-a"))).status,
    ).toBe(401);
    expect((await qr.GET(request(), ctx("client-a"))).status).toBe(401);
    expect(fakes.status).not.toHaveBeenCalled();
    expect(fakes.connect).not.toHaveBeenCalled();
    expect(fakes.disconnect).not.toHaveBeenCalled();
  });

  it("sessão desconhecida retorna 404 e nunca usa primeiro cliente", async () => {
    fakes.loggedIn = true;
    const routes = await import("@/app/api/waha/api/sessions/[session]/route");
    const qr = await import("@/app/api/waha/api/[session]/auth/qr/route");
    expect((await routes.GET(request(), ctx("inexistente"))).status).toBe(404);
    expect(
      (await routes.POST(request("POST"), ctx("inexistente"))).status,
    ).toBe(404);
    expect(
      (await routes.DELETE(request("DELETE"), ctx("inexistente"))).status,
    ).toBe(404);
    expect((await qr.GET(request(), ctx("inexistente"))).status).toBe(404);
    expect(fakes.status).not.toHaveBeenCalled();
    expect(fakes.connect).not.toHaveBeenCalled();
  });

  it("consultas autenticadas nunca iniciam ou reconectam sessão", async () => {
    fakes.loggedIn = true;
    const routes = await import("@/app/api/waha/api/sessions/[session]/route");
    const qr = await import("@/app/api/waha/api/[session]/auth/qr/route");
    expect((await routes.GET(request(), ctx("client-a"))).status).toBe(200);
    const qrResponse = await qr.GET(request(), ctx("client-a"));
    expect((await qrResponse.json()).status).toBe("STOPPED");
    expect(fakes.status).toHaveBeenCalledWith("client-a", { reconnect: false });
    expect(fakes.connect).not.toHaveBeenCalled();
  });

  it("POST de início e parada autenticados executam apenas ação solicitada", async () => {
    fakes.loggedIn = true;
    const routes = await import("@/app/api/waha/api/sessions/[session]/route");
    await routes.POST(request("POST", { name: "client-b" }), ctx("start"));
    expect(fakes.connect).toHaveBeenCalledWith("client-b");
    fakes.connect.mockClear();
    await routes.POST(request("POST", { name: "client-b" }), ctx("stop"));
    expect(fakes.disconnect).toHaveBeenCalledWith("client-b");
    expect(fakes.connect).not.toHaveBeenCalled();
  });

  it("permite chave de serviço própria e rejeita chave incorreta", async () => {
    process.env.TRACK_WAHA_API_KEY = "test-service-key-".repeat(3);
    const routes = await import("@/app/api/waha/api/sessions/[session]/route");
    const valid = new NextRequest(
      "http://localhost/api/waha/api/sessions/client-a",
      { headers: { "X-Api-Key": process.env.TRACK_WAHA_API_KEY } },
    );
    expect((await routes.GET(valid, ctx("client-a"))).status).toBe(200);
    const invalid = new NextRequest(valid.url, {
      headers: { "X-Api-Key": "incorreta" },
    });
    expect((await routes.GET(invalid, ctx("client-a"))).status).toBe(401);
  });

  it("nega mutação por cookie com origem diferente", async () => {
    fakes.loggedIn = true;
    const routes = await import("@/app/api/waha/api/sessions/[session]/route");
    const crossOrigin = new NextRequest(
      "http://localhost/api/waha/api/sessions/client-a",
      { method: "DELETE", headers: { Origin: "https://outra-origem.example" } },
    );
    expect((await routes.DELETE(crossOrigin, ctx("client-a"))).status).toBe(
      403,
    );
    expect(fakes.disconnect).not.toHaveBeenCalled();
  });
});
