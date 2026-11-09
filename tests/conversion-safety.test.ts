import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { NextRequest } from "next/server";
const network = vi.hoisted(() => ({
  requests: [] as Record<string, unknown>[],
  failNext: false,
}));
vi.mock("@/lib/auth", () => ({
  requireAuth: async () => {},
  login: async () => true,
  logout: async () => {},
  startSession: async () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/meta", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/meta")>();
  return {
    ...actual,
    sendEvent: vi.fn(async (opts: Record<string, unknown>) => {
      const event = opts.event as Record<string, unknown>;
      const store = await import("@/lib/store");
      const records = await store.listEvents({ offset: 0, limit: 100 });
      expect(
        records.some(
          (row) => row.event_id === event.event_id && row.status === "enviando",
        ),
      ).toBe(true);
      network.requests.push(opts);
      const failed = network.failNext;
      network.failNext = false;
      return {
        ok: !failed,
        httpStatus: failed ? 500 : 200,
        eventsReceived: failed ? 0 : 1,
        fbtraceId: "offline-test",
        errorMessage: failed ? "Falha simulada" : null,
        response: failed
          ? { error: { message: "simulada" } }
          : { events_received: 1 },
        body: { data: [event] },
      };
    }),
  };
});
let directory = "";
let store: typeof import("@/lib/store");
let actions: typeof import("@/app/actions");
let clientId = "";
let token = "";
let original: Record<string, string | undefined>;
beforeAll(async () => {
  original = {
    TRACK_DATA_DIR: process.env.TRACK_DATA_DIR,
    DATABASE_URL: process.env.DATABASE_URL,
    SUPABASE_DATABASE_URL: process.env.SUPABASE_DATABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    APP_SECRET: process.env.APP_SECRET,
  };
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "track-conversions-"));
  process.env.TRACK_DATA_DIR = directory;
  delete process.env.DATABASE_URL;
  delete process.env.SUPABASE_DATABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.APP_SECRET;
  store = await import("@/lib/store");
  actions = await import("@/app/actions");
  const { appSecret } = await import("@/lib/config");
  const { encrypt } = await import("@/lib/crypto");
  token = encrypt("fixture-token-never-sent", await appSecret());
  clientId = await store.insertClient({
    name: "Fixture",
    pixel_id: "123456789",
    page_id: "987654321",
    capi_token_enc: token,
  });
});
beforeEach(async () => {
  network.requests.length = 0;
  network.failNext = false;
  await store.updateClient(clientId, {
    pixel_id: "123456789",
    page_id: "987654321",
    waba_id: null,
    test_event_code: null,
    capi_token_enc: token,
  });
});
afterAll(() => {
  try {
    (globalThis as any).__trackDb?.close?.();
    delete (globalThis as any).__trackDb;
    delete (globalThis as any).__trackDbPath;
    fs.rmSync(directory, { recursive: true, force: true });
  } catch {}
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
async function input() {
  const leadId = await store.insertLead({
    client_id: clientId,
    name: "Contato fictício",
    phone:
      "55119" +
      Math.floor(Math.random() * 100000000)
        .toString()
        .padStart(8, "0"),
    ctwa_clid: "real-fixture-click-123456",
    country: "br",
    origin: "manual",
  });
  return {
    leadId,
    eventName: "Purchase",
    eventTimeIso: new Date(Date.now() - 60000).toISOString(),
    value: "100,00",
    currency: "BRL",
    contentName: "Pedido fictício",
    idempotencyKey: randomUUID(),
  };
}
describe("conversões duráveis", () => {
  it("persiste antes de enviar e repete a mesma intenção sem outro envio", async () => {
    const sale = await input();
    expect((await actions.sendEventAction(sale)).sent).toBe(true);
    expect((await actions.sendEventAction(sale)).sent).toBe(true);
    expect(network.requests).toHaveLength(1);
    expect(await store.listEventsForLead(sale.leadId)).toHaveLength(1);
  });
  it("coordena dois cliques simultâneos da mesma intenção", async () => {
    const sale = await input();
    await Promise.all([
      actions.sendEventAction(sale),
      actions.sendEventAction(sale),
    ]);
    expect(network.requests).toHaveLength(1);
    expect(await store.listEventsForLead(sale.leadId)).toHaveLength(1);
  });
  it("exige confirmação para uma segunda compra de verdade", async () => {
    const sale = await input();
    await actions.sendEventAction(sale);
    const next = { ...sale, idempotencyKey: randomUUID() };
    expect((await actions.sendEventAction(next)).sent).toBe(false);
    expect(network.requests).toHaveLength(1);
    expect(
      (await actions.sendEventAction({ ...next, confirmNewSale: true })).sent,
    ).toBe(true);
    expect(network.requests).toHaveLength(2);
  });
  it("reenvia o payload e pixel originais mesmo depois de alterar o cliente", async () => {
    const sale = await input();
    network.failNext = true;
    expect((await actions.sendEventAction(sale)).sent).toBe(false);
    await store.updateClient(clientId, {
      pixel_id: "999999999",
      test_event_code: "TEST-OTHER",
    });
    expect((await actions.sendEventAction(sale)).sent).toBe(true);
    expect(network.requests).toHaveLength(2);
    expect(network.requests[1].pixelId).toBe("123456789");
    expect(network.requests[1].testEventCode).toBeNull();
    expect(network.requests[1].event).toEqual(network.requests[0].event);
  });
  it("preserva o ID quando falha a gravação da resposta depois do envio", async () => {
    const sale = await input();
    const failure = vi
      .spyOn(store, "updateEvent")
      .mockRejectedValueOnce(new Error("banco indisponível"));
    expect((await actions.sendEventAction(sale)).sent).toBe(false);
    failure.mockRestore();
    expect(
      (await store.getEventByExternalId(clientId, sale.idempotencyKey))?.status,
    ).toBe("enviando");
    await actions.sendEventAction(sale);
    expect(network.requests).toHaveLength(1);
  });
  it("webhook com valor e repetição não envia compra automaticamente", async () => {
    const route = await import("@/app/api/webhook/leona/[key]/route");
    const client = (await store.getClient(clientId))!;
    const ctx = { params: Promise.resolve({ key: client.webhook_key }) };
    const request = () =>
      new NextRequest(
        "http://localhost/api/webhook/leona/" + client.webhook_key,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: "5511998765432",
            value: 500,
            status: "paid",
            event_id: "pedido-1",
          }),
        },
      );
    expect((await route.POST(request(), ctx)).status).toBe(200);
    expect((await route.POST(request(), ctx)).status).toBe(200);
    expect(network.requests).toHaveLength(0);
    expect((await route.GET()).status).toBe(405);
  });
  it("uma falha antes de persistir não deixa guard órfão bloqueando outra intenção", async () => {
    const sale = await input();
    const failure = vi
      .spyOn(store, "insertEvent")
      .mockRejectedValueOnce(new Error("banco indisponível"));
    expect((await actions.sendEventAction(sale)).sent).toBe(false);
    failure.mockRestore();
    expect(
      await store.getSetting(
        `conversion-guard:${clientId}:${sale.leadId}:Purchase`,
      ),
    ).toBeNull();
    expect(
      (await actions.sendEventAction({ ...sale, idempotencyKey: randomUUID() }))
        .sent,
    ).toBe(true);
    expect(network.requests).toHaveLength(1);
  });
  it("duas intenções concorrentes não viram duas compras e o histórico não ignora o bloqueio", async () => {
    const sale = await input();
    const next = { ...sale, idempotencyKey: randomUUID() };
    await Promise.all([
      actions.sendEventAction(sale),
      actions.sendEventAction(next),
    ]);
    expect(network.requests).toHaveLength(1);
    const records = await store.listEventsForLead(sale.leadId);
    expect(records).toHaveLength(2);
    const blocked = records.find((row) => row.status !== "enviado")!;
    const fd = new FormData();
    fd.set("event_id", blocked.id);
    await actions.resendEventAction(fd);
    expect(network.requests).toHaveLength(1);
  });
  it("uma UUID concorrente com outros dados não envia o payload vencedor sem conferência", async () => {
    const sale = await input();
    const results = await Promise.all([
      actions.sendEventAction(sale),
      actions.sendEventAction({ ...sale, value: "200,00" }),
    ]);
    expect(network.requests).toHaveLength(1);
    expect(results.filter((result) => result.sent)).toHaveLength(1);
  });
  it("não inventa CTWA a partir de pedido, fbclid ou conversionData arbitrário", async () => {
    const sale = await input();
    await store.updateLead(sale.leadId, {
      ctwa_clid: null,
      notes: "PedidoABC123456789012345678901234",
      raw: { fbclid: "B".repeat(32), conversionData: "A".repeat(32) },
    });
    expect((await actions.pullCtwaFromPhoneAction(sale.leadId)).ok).toBe(false);
    expect((await store.getLead(sale.leadId))?.ctwa_clid).toBeNull();
  });
  it("recupera CTWA somente de metadado ou parâmetro explicitamente identificado", async () => {
    const sale = await input();
    await store.updateLead(sale.leadId, {
      ctwa_clid: null,
      raw: {
        messages: [{ contextInfo: { ctwaClid: "real-explicit-click-123456" } }],
      },
    });
    expect((await actions.pullCtwaFromPhoneAction(sale.leadId)).ctwa_clid).toBe(
      "real-explicit-click-123456",
    );
    await store.updateLead(sale.leadId, {
      ctwa_clid: null,
      raw: null,
      notes: "https://example.test/path?ctwa_clid=real-url-click-123456",
    });
    expect((await actions.pullCtwaFromPhoneAction(sale.leadId)).ctwa_clid).toBe(
      "real-url-click-123456",
    );
  });
  it("resend não retoma lease recente e retoma uma expirada sem duplicar o envio", async () => {
    const sale = await input();
    network.failNext = true;
    await actions.sendEventAction(sale);
    const record = (await store.getEventByExternalId(
      clientId,
      sale.idempotencyKey,
    ))!;
    const context = (
      record.response as { request_context: Record<string, unknown> }
    ).request_context;
    await store.updateEvent(record.id, {
      status: "enviando",
      response: {
        request_context: {
          ...context,
          dispatch_started_at: new Date().toISOString(),
        },
      },
    });
    const fd = new FormData();
    fd.set("event_id", record.id);
    await actions.resendEventAction(fd);
    expect(network.requests).toHaveLength(1);
    await store.updateEvent(record.id, {
      status: "enviando",
      response: {
        request_context: {
          ...context,
          dispatch_started_at: new Date(Date.now() - 180000).toISOString(),
        },
      },
    });
    await Promise.all([
      actions.resendEventAction(fd),
      actions.resendEventAction(fd),
    ]);
    expect(network.requests).toHaveLength(2);
    expect((await store.getEvent(record.id))?.status).toBe("enviado");
  });
  it("bloqueia CTWA real sem Página/WABA antes de persistir ou contatar a Meta", async () => {
    const sale = await input();
    await store.updateClient(clientId, { page_id: null, waba_id: null });
    const preview = await actions.previewEventAction(sale);
    expect(preview.ok).toBe(false);
    expect(preview.errors.join(" ")).toMatch(/Página|WhatsApp Business/);
    expect((await actions.sendEventAction(sale)).sent).toBe(false);
    expect(network.requests).toHaveLength(0);
    expect(await store.listEventsForLead(sale.leadId)).toHaveLength(0);
  });
  it("CTWA real com Página correta permanece no payload conferido e enviado", async () => {
    const sale = await input();
    const preview = await actions.previewEventAction(sale);
    expect(preview.ok).toBe(true);
    expect(preview.payload?.action_source).toBe("business_messaging");
    expect(preview.payload?.messaging_channel).toBe("whatsapp");
    expect(preview.payload?.user_data).toMatchObject({
      ctwa_clid: "real-fixture-click-123456",
      page_id: "987654321",
    });
    expect((await actions.sendEventAction(sale)).sent).toBe(true);
    const sentEvent = network.requests[0].event as Record<string, unknown>;
    expect(sentEvent.user_data).toEqual(preview.payload?.user_data);
    expect(sentEvent.action_source).toBe("business_messaging");
    expect(sentEvent.messaging_channel).toBe("whatsapp");
  });
  it("referência sintética e fbclid não entram como CTWA no envio por telefone", async () => {
    const sale = await input();
    const fbclid = "fbclid-is-not-a-whatsapp-click-123456";
    await store.updateLead(sale.leadId, {
      ctwa_clid: "ctwa_ad_120000000001",
      raw: { fbclid, source_url: "https://example.test/?fbclid=" + fbclid },
    });
    await store.updateClient(clientId, { page_id: null, waba_id: null });
    expect((await actions.pullCtwaFromPhoneAction(sale.leadId)).ok).toBe(false);
    const preview = await actions.previewEventAction(sale);
    expect(preview.ok).toBe(true);
    expect(preview.payload?.action_source).toBe("chat");
    expect(preview.payload?.user_data).not.toHaveProperty("ctwa_clid");
    expect((await actions.sendEventAction(sale)).sent).toBe(true);
    expect(network.requests[0].event).not.toHaveProperty("user_data.ctwa_clid");
    expect(JSON.stringify(network.requests[0].event)).not.toContain(fbclid);
  });

  it("bloqueia usar um clique recebido depois do horário da conversão", async () => {
    const sale = await input();
    const lead = (await store.getLead(sale.leadId))!;
    await store.updateLead(sale.leadId, {
      raw: {
        ...(lead.raw as Record<string, unknown>),
        _tracking_snapshot: {
          observed_at: new Date(
            Date.parse(sale.eventTimeIso) + 60_000,
          ).toISOString(),
        },
      },
    });
    const preview = await actions.previewEventAction(sale);
    expect(preview.ok).toBe(false);
    expect(preview.errors.join(" ")).toContain("após o horário");
    expect((await actions.sendEventAction(sale)).sent).toBe(false);
    expect(network.requests).toHaveLength(0);
  });
  it("aceita clique e conversão no mesmo segundo sem truncar para o minuto", async () => {
    const sale = await input();
    sale.eventTimeIso = new Date(
      Math.floor(Date.parse(sale.eventTimeIso) / 1000) * 1000,
    ).toISOString();
    const lead = (await store.getLead(sale.leadId))!;
    await store.updateLead(sale.leadId, {
      raw: {
        ...(lead.raw as Record<string, unknown>),
        _tracking_snapshot: {
          observed_at: new Date(
            Date.parse(sale.eventTimeIso) + 500,
          ).toISOString(),
        },
      },
    });
    expect((await actions.previewEventAction(sale)).ok).toBe(true);
    expect((await actions.sendEventAction(sale)).sent).toBe(true);
    expect(network.requests).toHaveLength(1);
  });
});
