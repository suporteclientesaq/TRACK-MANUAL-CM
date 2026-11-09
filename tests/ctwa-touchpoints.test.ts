import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mergeLeadUpdate, withTrackingTouch } from "@/lib/lead-tracking";
import { mergeLead, parseBody, parseLead } from "@/lib/leona";
import { toLead } from "@/lib/store-rows";

const first = "2026-11-09T10:00:00.000Z";
const second = "2026-11-09T11:00:00.000Z";
const third = "2026-11-09T12:00:00.000Z";
const initial = {
  id: "lead",
  phone: "5511999990001",
  client_id: "client",
  ctwa_clid: "click-A",
  source_id: "120000000001",
  source_url: "https://example.test/a",
  headline: "Criativo A",
  thumbnail_url: "https://example.test/a.png",
  raw: {
    source_id: "120000000001",
    messages: [{ id: "old", text: "Olá", at: first, fromMe: false }],
  },
};
function update(
  previous: Record<string, unknown>,
  incoming: Record<string, unknown>,
  at = second,
  extra: Record<string, unknown> = {},
) {
  return {
    ...previous,
    ...mergeLeadUpdate(
      previous,
      { ...incoming },
      withTrackingTouch(
        { provider: "test", received_at: at, ...extra },
        incoming,
        "test",
      ),
      at,
    ),
  };
}

describe("referência coerente de clique e anúncio", () => {
  it("um anúncio novo sem clique não herda CTWA ou criativo anteriores", () => {
    const row = update(initial, { source_id: "120000000002" });
    expect(row).toMatchObject({
      source_id: "120000000002",
      ctwa_clid: null,
      headline: null,
      thumbnail_url: null,
      source_url: null,
    });
    expect((row.raw as { messages: unknown[] }).messages).toHaveLength(1);
  });
  it("um clique novo sem anúncio não herda a origem antiga pelo raw", () => {
    const row = update(initial, { ctwa_clid: "click-B" });
    expect(row).toMatchObject({
      ctwa_clid: "click-B",
      source_id: null,
      headline: null,
      thumbnail_url: null,
    });
    expect(toLead(row).source_id).toBeNull();
    expect(toLead(row).headline).toBeNull();
  });
  it("o mesmo anúncio sem prova do mesmo clique não reaproveita o token", () => {
    expect(
      update(initial, { source_id: initial.source_id }).ctwa_clid,
    ).toBeNull();
  });
  it("somente o mesmo clique explícito pode completar metadados do toque", () => {
    const row = update(initial, {
      ctwa_clid: initial.ctwa_clid,
      headline: "Título completo",
    });
    expect(row).toMatchObject({
      ctwa_clid: "click-A",
      source_id: initial.source_id,
      headline: "Título completo",
    });
  });
  it("mensagem sem referência/outgoing não restaura origem de um patch obsoleto", () => {
    const latest = update(initial, {
      ctwa_clid: "click-B",
      source_id: "120000000002",
    });
    for (const extra of [{}, { fromMe: true }]) {
      const raw = withTrackingTouch(
        { provider: "test", message_text: "Tudo certo", ...extra },
        extra.fromMe
          ? { ctwa_clid: "outgoing-quoted", source_id: initial.source_id }
          : {},
        "test",
        third,
      );
      const preserved = {
        ...latest,
        ...mergeLeadUpdate(latest, initial, raw, third),
      };
      expect(preserved).toMatchObject({
        ctwa_clid: "click-B",
        source_id: "120000000002",
      });
    }
  });
  it("replay antigo fica no histórico sem substituir o toque mais recente", () => {
    const latest = update(
      initial,
      { ctwa_clid: "click-B", source_id: "120000000002" },
      third,
      { message_id: "new" },
    );
    const replay = update(
      latest,
      { ctwa_clid: "click-A", source_id: initial.source_id },
      first,
      { message_id: "old" },
    );
    expect(replay).toMatchObject({
      ctwa_clid: "click-B",
      source_id: "120000000002",
    });
    const raw = replay.raw as {
      _tracking_snapshot: { ctwa_clid: string };
      _tracking_touchpoints: unknown[];
    };
    expect(raw._tracking_snapshot.ctwa_clid).toBe("click-B");
    expect(raw._tracking_touchpoints.length).toBeGreaterThanOrEqual(2);
    expect(replay.raw).not.toHaveProperty("_tracking_touch");
  });
  it("limpar referência não ressuscita anúncio antigo a partir do raw", () => {
    const row = {
      ...initial,
      ...mergeLeadUpdate(
        initial,
        {},
        withTrackingTouch({ provider: "manual" }, {}, "manual", second, {
          clear: true,
        }),
        second,
      ),
    };
    expect(toLead(row)).toMatchObject({
      ctwa_clid: null,
      source_id: null,
      headline: null,
      thumbnail_url: null,
    });
  });
  it("Leona não aceita click_id genérico nem mistura referências de objetos separados", () => {
    const parsed = parseLead({
      phone: initial.phone,
      click_id: "generic-id",
      fbclid: "facebook-web-id",
    });
    expect(parsed.ok && parsed.lead.ctwa_clid).toBeNull();
    const body = parseBody(
      JSON.stringify({
        customer: { phone: initial.phone },
        referral: { ctwa_clid: "click-one" },
        oldReferral: {
          source_id: "120000000099",
          thumbnail_url: "https://old.test/img",
        },
      }),
      "application/json",
    );
    const nested = parseLead(body);
    expect(nested.ok && nested.lead).toMatchObject({
      ctwa_clid: "click-one",
      source_id: null,
      thumbnail_url: null,
    });
  });
  it("o merge usado pelo formulário/importação segue a mesma separação", () => {
    const parsed = parseLead({ phone: initial.phone, ctwa_clid: "click-new" });
    if (!parsed.ok) throw new Error(parsed.error);
    expect(mergeLead(initial, parsed.lead)).toMatchObject({
      ctwa_clid: "click-new",
      source_id: null,
      headline: null,
    });
  });
});

describe("toques no SQLite e importação concorrente", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "track-touchpoints-"));
  const saved = process.env.TRACK_DATA_DIR;
  let store: typeof import("@/lib/store");
  let ingest: typeof import("@/lib/ingest");
  let clientId: string;
  beforeAll(async () => {
    vi.resetModules();
    process.env.TRACK_DATA_DIR = temp;
    store = await import("@/lib/store");
    ingest = await import("@/lib/ingest");
    clientId = await store.insertClient({ name: "Rastreamento de teste" });
  });
  afterAll(() => {
    try {
      (globalThis as any).__trackDb?.close?.();
      delete (globalThis as any).__trackDb;
      delete (globalThis as any).__trackDbPath;
      fs.rmSync(temp, { recursive: true, force: true });
    } catch {}
    if (saved === undefined) delete process.env.TRACK_DATA_DIR;
    else process.env.TRACK_DATA_DIR = saved;
  });
  it("importar anúncio novo limpa clique anterior e mantém o histórico da conversa", async () => {
    const created = await ingest.ingestLead(
      clientId,
      {
        phone: initial.phone,
        ctwa_clid: "click-original",
        source_id: "120000000001",
        headline: "Anterior",
      },
      "leona",
      {
        received_at: first,
        provider: "fixture",
        message_id: "message-first",
        message_text: "Olá",
      },
    );
    expect(created.ok).toBe(true);
    await ingest.ingestMany(clientId, [
      { phone: initial.phone, source_id: "120000000002", headline: "Atual" },
    ]);
    const row = (await store.findLead(clientId, initial.phone))!;
    expect(row).toMatchObject({
      ctwa_clid: null,
      source_id: "120000000002",
      headline: "Atual",
    });
    expect((row.raw as { messages: unknown[] }).messages).toHaveLength(1);
  });
  it("criação concorrente aplica a referência mais nova sem juntar os dois cliques", async () => {
    const phone = "5511999990002";
    await Promise.all([
      ingest.ingestLead(
        clientId,
        { phone, ctwa_clid: "older-click", source_id: "120000000003" },
        "leona",
        { received_at: first, provider: "fixture", message_id: "older" },
      ),
      ingest.ingestLead(
        clientId,
        { phone, ctwa_clid: "newer-click" },
        "leona",
        { received_at: second, provider: "fixture", message_id: "newer" },
      ),
    ]);
    expect(await store.findLead(clientId, phone)).toMatchObject({
      ctwa_clid: "newer-click",
      source_id: null,
    });
  });
  it("o formulário antigo não substitui a referência que chegou durante a edição", async () => {
    const phone = "5511999990003";
    await ingest.ingestLead(
      clientId,
      { phone, ctwa_clid: "form-old-click", source_id: "120000000004" },
      "leona",
      { received_at: first },
    );
    const baseline = (await store.findLead(clientId, phone))!;
    await ingest.ingestLead(
      clientId,
      { phone, ctwa_clid: "webhook-new-click", source_id: "120000000005" },
      "leona",
      { received_at: second },
    );
    const operation = withTrackingTouch(
      {},
      { ctwa_clid: "manual-pasted-click" },
      "manual",
      third,
      { forceNew: true, expectedFields: baseline },
    );
    await expect(
      Promise.resolve().then(() =>
        store.updateLeadWithRaw(baseline.id, {}, operation),
      ),
    ).rejects.toThrow("Recarregue");
    expect(await store.getLead(baseline.id)).toMatchObject({
      ctwa_clid: "webhook-new-click",
      source_id: "120000000005",
    });
  });
});
