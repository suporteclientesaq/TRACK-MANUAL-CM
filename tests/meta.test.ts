import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildEvent, fetchAd, sendEvent, type BuildEventInput } from "@/lib/meta";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const NOW = new Date("2026-09-21T15:00:00Z");

const base = (over: Partial<BuildEventInput> = {}): BuildEventInput => ({
  client: { page_id: "111222333", waba_id: null, id_mode: "page", send_extra_data: true },
  lead: {
    id: "8f1c0a52-0000-4000-8000-000000000001",
    name: "Dioni Santana 🥰",
    phone: "5511951907539",
    email: null,
    city: "São Paulo",
    state: "SP",
    zip: null,
    country: "br",
    ctwa_clid: "AfgzZRtxcTvqG-GODTKuPx_exemplo",
    source_id: "120247299656290265",
    source_url: "https://www.instagram.com/p/XXXX/",
  },
  eventName: "Purchase",
  eventId: "evt-1",
  eventTime: new Date("2026-09-21T14:00:00Z"),
  now: NOW,
  value: 29.9,
  currency: "brl",
  contentName: "3 - FOTOS - 29,90",
  ...over,
});

describe("buildEvent com ctwa_clid", () => {
  it("monta o evento de mensagem de empresa no formato do Meta", () => {
    const { event, errors, actionSource } = buildEvent(base());
    expect(errors).toEqual([]);
    expect(actionSource).toBe("business_messaging");
    expect(event).toMatchObject({
      event_name: "Purchase",
      event_time: Math.floor(new Date("2026-09-21T14:00:00Z").getTime() / 1000),
      event_id: "evt-1",
      action_source: "business_messaging",
      messaging_channel: "whatsapp",
      custom_data: { value: 29.9, currency: "BRL", content_name: "3 - FOTOS - 29,90" },
    });
  });

  it("manda o ctwa_clid em texto puro e o resto com hash", () => {
    const user = buildEvent(base()).event.user_data as Record<string, unknown>;
    expect(user.ctwa_clid).toBe("AfgzZRtxcTvqG-GODTKuPx_exemplo");
    expect(user.page_id).toBe("111222333");
    expect(user.ph).toEqual([sha("5511951907539")]);
    expect(user.fn).toEqual([sha("dioni")]);
    expect(user.ln).toEqual([sha("santana")]);
    expect(user.ct).toEqual([sha("saopaulo")]);
    expect(user.st).toEqual([sha("sp")]);
    expect(user.country).toEqual([sha("br")]);
    // nada de dado pessoal legível no corpo
    expect(JSON.stringify(user)).not.toContain("5511951907539");
    expect(JSON.stringify(user)).not.toMatch(/dioni/i);
  });

  it("manda as duas formas do telefone quando o WhatsApp veio sem o nono dígito", () => {
    const { event } = buildEvent(base({ lead: { ...base().lead, phone: "557481461611" } }));
    expect((event.user_data as Record<string, unknown>).ph).toEqual([sha("557481461611"), sha("5574981461611")]);
  });

  it("usa o ID da Conta do WhatsApp Business quando o cliente está nesse modo", () => {
    const { event } = buildEvent(
      base({ client: { page_id: "111", waba_id: "999888", id_mode: "waba", send_extra_data: true } })
    );
    const user = event.user_data as Record<string, unknown>;
    expect(user.whatsapp_business_account_id).toBe("999888");
    expect(user.page_id).toBeUndefined();
  });

  it("cai para o outro ID com aviso quando o escolhido está vazio", () => {
    const { event, warnings, errors } = buildEvent(
      base({ client: { page_id: "111", waba_id: null, id_mode: "waba", send_extra_data: true } })
    );
    expect(errors).toEqual([]);
    expect((event.user_data as Record<string, unknown>).page_id).toBe("111");
    expect(warnings.join(" ")).toMatch(/usando o ID da Página/);
  });

  it("bloqueia quando não há Página nem Conta do WhatsApp Business", () => {
    const { errors } = buildEvent(
      base({ client: { page_id: null, waba_id: null, id_mode: "page", send_extra_data: true } })
    );
    expect(errors.join(" ")).toMatch(/ID da Página/);
  });

  it("com dados extras desligados manda só o conjunto mínimo documentado", () => {
    const { event } = buildEvent(
      base({ client: { page_id: "111", waba_id: null, id_mode: "page", send_extra_data: false } })
    );
    expect(event.user_data).toEqual({ ctwa_clid: "AfgzZRtxcTvqG-GODTKuPx_exemplo", page_id: "111" });
    expect(event.custom_data).toEqual({ value: 29.9, currency: "BRL", content_name: "3 - FOTOS - 29,90" });
  });

  it("inclui ID e URL de origem como propriedades personalizadas", () => {
    const custom = buildEvent(base()).event.custom_data as Record<string, unknown>;
    expect(custom.ctwa_source_id).toBe("120247299656290265");
    expect(custom.ctwa_source_url).toBe("https://www.instagram.com/p/XXXX/");
  });
});

describe("buildEvent sem ctwa_clid", () => {
  const noClid = (over: Partial<BuildEventInput> = {}) =>
    base({ lead: { ...base().lead, ctwa_clid: null }, ...over });

  it("vira evento de conversa casado pelo telefone, com aviso", () => {
    const { event, actionSource, warnings, errors } = buildEvent(noClid());
    expect(errors).toEqual([]);
    expect(actionSource).toBe("chat");
    expect(event.messaging_channel).toBeUndefined();
    expect((event.user_data as Record<string, unknown>).ph).toEqual([sha("5511951907539")]);
    expect(warnings.join(" ")).toMatch(/não tem ctwa_clid/);
  });

  it("manda o telefone mesmo com dados extras desligados", () => {
    const { event } = buildEvent(
      noClid({ client: { page_id: "111", waba_id: null, id_mode: "page", send_extra_data: false } })
    );
    expect((event.user_data as Record<string, unknown>).ph).toEqual([sha("5511951907539")]);
  });

  it("troca LeadSubmitted por Lead, que é o evento padrão fora de mensagens", () => {
    const { event } = buildEvent(noClid({ eventName: "LeadSubmitted", value: null }));
    expect(event.event_name).toBe("Lead");
  });
});

describe("validações", () => {
  it("Compra exige valor maior que zero", () => {
    expect(buildEvent(base({ value: null })).errors.join(" ")).toMatch(/valor maior que zero/);
    expect(buildEvent(base({ value: 0 })).errors.join(" ")).toMatch(/valor maior que zero/);
  });
  it("Lead não exige valor e não manda moeda sem valor", () => {
    const { event, errors } = buildEvent(base({ eventName: "LeadSubmitted", value: null, contentName: "" }));
    expect(errors).toEqual([]);
    const custom = event.custom_data as Record<string, unknown>;
    expect(custom.value).toBeUndefined();
    expect(custom.currency).toBeUndefined();
  });
  it("recusa evento no futuro", () => {
    const { errors } = buildEvent(base({ eventTime: new Date("2026-09-22T15:00:00Z") }));
    expect(errors.join(" ")).toMatch(/futuro/);
  });
  it("avisa sobre evento com mais de 7 dias", () => {
    const { warnings, errors } = buildEvent(base({ eventTime: new Date("2026-09-10T15:00:00Z") }));
    expect(errors).toEqual([]);
    expect(warnings.join(" ")).toMatch(/mais de 7 dias/);
  });
  it("recusa moeda inválida", () => {
    expect(buildEvent(base({ currency: "reais" })).errors.join(" ")).toMatch(/Moeda inválida/);
  });
});

describe("sendEvent", () => {
  const event = buildEvent(base()).event;

  it("envia para o endereço certo, guarda o corpo sem o token e lê o sucesso", async () => {
    let calledUrl = "";
    let calledBody = "";
    const result = await sendEvent({
      apiVersion: "v25.0",
      pixelId: "1704000000002274",
      accessToken: "TOKEN_SECRETO",
      event,
      testEventCode: "TEST123",
      fetchImpl: async (url, init) => {
        calledUrl = url;
        calledBody = String(init?.body);
        return new Response(JSON.stringify({ events_received: 1, messages: [], fbtrace_id: "Abc123" }), { status: 200 });
      },
    });
    expect(calledUrl).toBe("https://graph.facebook.com/v25.0/1704000000002274/events?access_token=TOKEN_SECRETO");
    expect(JSON.parse(calledBody)).toMatchObject({ data: [event], test_event_code: "TEST123" });
    expect(result.ok).toBe(true);
    expect(result.eventsReceived).toBe(1);
    expect(result.fbtraceId).toBe("Abc123");
    expect(JSON.stringify(result.body)).not.toContain("TOKEN_SECRETO");
  });

  it("não manda test_event_code em produção", async () => {
    const result = await sendEvent({
      apiVersion: "v25.0",
      pixelId: "1",
      accessToken: "t",
      event,
      testEventCode: "",
      fetchImpl: async () => new Response(JSON.stringify({ events_received: 1 }), { status: 200 }),
    });
    expect(result.body.test_event_code).toBeUndefined();
  });

  it("traduz o erro do Meta", async () => {
    const result = await sendEvent({
      apiVersion: "v25.0",
      pixelId: "1",
      accessToken: "t",
      event,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: { message: "Invalid parameter", code: 100, error_subcode: 2804019, error_user_msg: "ctwa_clid inválido", fbtrace_id: "Zzz" },
          }),
          { status: 400 }
        ),
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(result.errorMessage).toContain("ctwa_clid inválido");
    expect(result.errorMessage).toContain("100/2804019");
    expect(result.fbtraceId).toBe("Zzz");
  });

  it("não quebra quando a rede falha", async () => {
    const result = await sendEvent({
      apiVersion: "v25.0",
      pixelId: "1",
      accessToken: "t",
      event,
      fetchImpl: async () => {
        throw new Error("rede caiu");
      },
    });
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toMatch(/rede caiu/);
  });
});

describe("fetchAd", () => {
  it("recusa ID de origem que não é ID de anúncio", async () => {
    const res = await fetchAd({ apiVersion: "v25.0", adId: "abc", accessToken: "t", fetchImpl: async () => new Response("{}") });
    expect(res.ok).toBe(false);
  });

  it("junta nomes, miniatura e números", async () => {
    const res = await fetchAd({
      apiVersion: "v25.0",
      adId: "120247299656290265",
      accessToken: "t",
      fetchImpl: async (url) => {
        if (url.includes("/insights")) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  spend: "153.42",
                  impressions: "10432",
                  clicks: "311",
                  actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "87" }],
                },
              ],
            })
          );
        }
        return new Response(
          JSON.stringify({
            name: "AD 03 - Vídeo",
            effective_status: "ACTIVE",
            adset: { id: "2", name: "Mulheres 25-45" },
            campaign: { id: "3", name: "Fotos IA - Mensagens" },
            creative: { title: "Título", body: "Texto", thumbnail_url: "https://x/thumb.jpg" },
          })
        );
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.ad).toMatchObject({
      ad_name: "AD 03 - Vídeo",
      adset_name: "Mulheres 25-45",
      campaign_name: "Fotos IA - Mensagens",
      thumbnail_url: "https://x/thumb.jpg",
      spend: 153.42,
      impressions: 10432,
      clicks: 311,
      conversations: 87,
    });
  });

  it("devolve os nomes mesmo se os números falharem", async () => {
    const res = await fetchAd({
      apiVersion: "v25.0",
      adId: "120247299656290265",
      accessToken: "t",
      fetchImpl: async (url) => {
        if (url.includes("/insights")) throw new Error("falhou");
        return new Response(JSON.stringify({ name: "AD 01" }));
      },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.ad.ad_name).toBe("AD 01");
      expect(res.ad.spend).toBeNull();
    }
  });
});
