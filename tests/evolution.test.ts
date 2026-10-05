import { describe, expect, it } from "vitest";
import { parseEvolutionWebhook } from "@/lib/evolution";

describe("parseEvolutionWebhook", () => {
  it("extrai telefone, nome, ctwa_clid e anúncio de mensagem Click-to-WhatsApp (Evolution v2)", () => {
    const payload = {
      event: "messages.upsert",
      instance: "minha-instancia",
      data: {
        key: {
          remoteJid: "5511999998888@s.whatsapp.net",
          fromMe: false,
          id: "3EB012345",
        },
        pushName: "Lucas Teste",
        message: {
          extendedTextMessage: {
            text: "Olá! Vi seu anúncio no Instagram",
            contextInfo: {
              ctwaClid: "AfgzZRtxcTvqG-GODTKuPx_exemplo",
              externalAdReply: {
                title: "Promoção Especial",
                body: "Compre agora com 20% off",
                mediaType: 1,
                thumbnailUrl: "https://x.com/thumb.jpg",
                sourceUrl: "https://instagram.com/p/123",
                sourceId: "120246958877430258",
              },
            },
          },
        },
      },
    };

    const result = parseEvolutionWebhook(payload);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.lead.phone).toBe("5511999998888");
    expect(result.lead.name).toBe("Lucas Teste");
    expect(result.lead.ctwa_clid).toBe("AfgzZRtxcTvqG-GODTKuPx_exemplo");
    expect(result.lead.source_id).toBe("120246958877430258");
    expect(result.lead.headline).toBe("Promoção Especial");
    expect(result.lead.thumbnail_url).toBe("https://x.com/thumb.jpg");
    expect(result.lead.message_text).toBe("Olá! Vi seu anúncio no Instagram");
    expect(result.lead.instance).toBe("minha-instancia");
  });

  it("ignora mensagens enviadas pelo próprio usuário (fromMe: true)", () => {
    const payload = {
      event: "messages.upsert",
      data: {
        key: {
          remoteJid: "5511999998888@s.whatsapp.net",
          fromMe: true,
        },
      },
    };

    const result = parseEvolutionWebhook(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ignored).toBe(true);
    }
  });

  it("ignora mensagens de grupos (@g.us)", () => {
    const payload = {
      event: "messages.upsert",
      data: {
        key: {
          remoteJid: "123456789-987654@g.us",
          fromMe: false,
        },
      },
    };

    const result = parseEvolutionWebhook(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ignored).toBe(true);
    }
  });
});
