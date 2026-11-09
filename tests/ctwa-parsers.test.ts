import { describe, expect, it } from "vitest";
import {
  ctwaFromUrl,
  extractBaileysProtobufAd,
  normalizeCtwaClid,
} from "@/lib/ctwa";
import { parseEvolutionWebhook } from "@/lib/evolution";
import { parseWahaWebhook } from "@/lib/waha";

const click = "AfgzZRtxcTvqG-GODTKuPx_real_click";
const ad = "120246958877430258";
const evolution = (
  contextInfo: Record<string, unknown>,
  root: Record<string, unknown> = {},
) =>
  parseEvolutionWebhook({
    event: "messages.upsert",
    data: {
      key: {
        remoteJid: "5511999998888@s.whatsapp.net",
        fromMe: false,
        id: "fixture-message",
      },
      message: { extendedTextMessage: { text: "Olá", contextInfo } },
      ...root,
    },
  });
const waha = (
  contextInfo: Record<string, unknown>,
  root: Record<string, unknown> = {},
) =>
  parseWahaWebhook({
    event: "message",
    payload: {
      from: "5511999998888@c.us",
      fromMe: false,
      id: "fixture-message",
      body: "Olá",
      _data: { contextInfo },
      ...root,
    },
  });

describe("CTWA explícito e identidade do clique", () => {
  it("preserva o token de um campo explícito sem decodificações heurísticas", () => {
    const base64Looking = Buffer.from(
      "outro-conteudo-longo-que-nao-e-o-token",
    ).toString("base64");
    expect(normalizeCtwaClid(base64Looking)).toBe(base64Looking);
    expect(normalizeCtwaClid(Buffer.from(click, "utf8"))).toBe(click);
    expect(normalizeCtwaClid(Buffer.from(click, "utf8").toJSON())).toBe(click);
    expect(normalizeCtwaClid(new Uint8Array([0, 255, 127, 1]))).toBeNull();
  });
  it("rejeita placeholders, referências de anúncio e valores malformados", () => {
    for (const candidate of [
      "ctwa_ad_123456",
      "ad_123456",
      "null",
      "undefined",
      "0",
      "clique com espaços",
      "x".repeat(4097),
      {},
      123,
      "real\nclick",
    ])
      expect(normalizeCtwaClid(candidate)).toBeNull();
  });
  it("lê somente parâmetro CTWA explícito e rejeita parâmetros ambíguos", () => {
    expect(ctwaFromUrl("https://example.test/?fbclid=" + click)).toBeNull();
    expect(ctwaFromUrl("https://example.test/?ctwa_clid=" + click)).toBe(click);
    expect(ctwaFromUrl("https://example.test/?ctwaClid=" + click)).toBe(click);
    expect(ctwaFromUrl("javascript:alert(1)?ctwa_clid=" + click)).toBeNull();
    expect(
      ctwaFromUrl("https://example.test/?ctwa_clid=one&ctwa_clid=two"),
    ).toBeNull();
  });

  for (const [name, parse] of [
    ["Evolution", evolution],
    ["WAHA", waha],
  ] as const) {
    it(`${name}: CTWA do contexto não herda anúncio nem criativo da raiz`, () => {
      const result = parse(
        { ctwaClid: click },
        {
          externalAdReply: {
            sourceId: ad,
            sourceUrl: "https://example.test/old",
            title: "Criativo antigo",
            thumbnailUrl: "https://example.test/old.jpg",
          },
        },
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.lead.ctwa_clid).toBe(click);
        expect(result.lead.source_id).toBeNull();
        expect(result.lead.source_url).toBeNull();
        expect(result.lead.headline).toBeNull();
        expect(result.lead.thumbnail_url).toBeNull();
      }
    });
    it(`${name}: anúncio do contexto não herda CTWA da raiz`, () => {
      const result = parse(
        { externalAdReply: { sourceId: ad } },
        { ctwaClid: click },
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.lead.source_id).toBe(ad);
        expect(result.lead.ctwa_clid).toBeNull();
      }
    });
    it(`${name}: referência completa da raiz funciona quando não há contexto de anúncio`, () => {
      const result = parse(
        {},
        { ctwaClid: click, externalAdReply: { sourceId: ad } },
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.lead.source_id).toBe(ad);
        expect(result.lead.ctwa_clid).toBe(click);
      }
    });
    it(`${name}: conversionData e fbclid não são promovidos a CTWA`, () => {
      for (const conversionData of [
        click,
        Buffer.from(click),
        Buffer.from([1, 2, 3, 4, 5]),
      ]) {
        const result = parse({
          conversionData,
          conversion_data: click,
          externalAdReply: {
            sourceId: ad,
            sourceUrl: "https://example.test/?fbclid=" + click,
          },
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.lead.ctwa_clid).toBeNull();
          expect(result.lead.source_id).toBe(ad);
        }
      }
    });
    it(`${name}: preserva campo CTWA ou URL explicitamente identificada`, () => {
      for (const context of [
        { ctwaClid: click },
        { ctwa_clid: Buffer.from(click) },
        {
          externalAdReply: {
            sourceId: ad,
            sourceUrl: "https://example.test/?ctwa_clid=" + click,
          },
        },
      ]) {
        const result = parse(context);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.lead.ctwa_clid).toBe(click);
      }
    });
  }

  it("Evolution: snapshot Baileys é isolado dos campos de referência da raiz", () => {
    const result = evolution({}, { _baileys_source_id: ad, ctwaClid: click });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lead.source_id).toBe(ad);
      expect(result.lead.ctwa_clid).toBeNull();
    }
  });

  it("Baileys: ignora conversionData/fbclid e preserva metadados separados de anúncio", () => {
    const result = extractBaileysProtobufAd({
      extendedTextMessage: {
        contextInfo: {
          conversionData: Buffer.from(click),
          externalAdReply: {
            sourceId: ad,
            sourceUrl: "https://example.test/?fbclid=" + click,
          },
        },
      },
    });
    expect(result.bctwa).toBeNull();
    expect(result.bAdId).toBe(ad);
  });
  it("Baileys: lê CTWA explícito inclusive em mensagem embrulhada", () => {
    const result = extractBaileysProtobufAd({
      ephemeralMessage: {
        message: {
          audioMessage: {
            contextInfo: {
              ctwaClid: Buffer.from(click),
              externalAdReply: { sourceId: ad },
            },
          },
        },
      },
    });
    expect(result.bctwa).toBe(click);
    expect(result.bAdId).toBe(ad);
  });
  it("Baileys: não junta clique e anúncio de contextos diferentes", () => {
    const result = extractBaileysProtobufAd({
      extendedTextMessage: { contextInfo: { ctwaClid: click } },
      imageMessage: { contextInfo: { externalAdReply: { sourceId: ad } } },
    });
    expect(result.bctwa).toBe(click);
    expect(result.bAdId).toBeNull();
  });
});
