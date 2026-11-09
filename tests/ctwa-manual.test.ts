import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireAuth: async () => {},
  login: async () => true,
  logout: async () => {},
  startSession: async () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error("TEST_REDIRECT:" + url);
  },
}));
vi.mock("@/lib/ingest", () => ({
  enrichAdInRealTime: async () => {},
  ingestMany: async () => ({}),
}));

let dir = "";
let saved: Record<string, string | undefined>;
let store: typeof import("@/lib/store");
let actions: typeof import("@/app/actions");
let client: string;
let phone = 0;
const adA = "120000000001";
const adB = "120000000002";
const clickA = "real-provider-click-A-123456";
const clickB = "real-provider-click-B-123456";

beforeAll(async () => {
  saved = Object.fromEntries(
    [
      "TRACK_DATA_DIR",
      "DATABASE_URL",
      "SUPABASE_DATABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "APP_SECRET",
    ].map((key) => [key, process.env[key]]),
  );
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "track-ctwa-manual-"));
  process.env.TRACK_DATA_DIR = dir;
  for (const key of [
    "DATABASE_URL",
    "SUPABASE_DATABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "APP_SECRET",
  ])
    delete process.env[key];
  store = await import("@/lib/store");
  actions = await import("@/app/actions");
  client = await store.insertClient({ name: "Empresa fictícia" });
});
afterAll(() => {
  try {
    (globalThis as any).__trackDb?.close?.();
    delete (globalThis as any).__trackDb;
    delete (globalThis as any).__trackDbPath;
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
async function contact(extra: Record<string, unknown> = {}) {
  phone += 1;
  return store.insertLead({
    client_id: client,
    phone: "551190000" + String(phone).padStart(4, "0"),
    ...extra,
  });
}
const referral = (sourceId: string, ctwaClid?: string) => ({
  contextInfo: {
    ...(ctwaClid ? { ctwaClid } : {}),
    externalAdReply: {
      sourceId,
      sourceUrl: "https://example.test/ad?ad_id=" + sourceId,
      title: "Anúncio " + sourceId,
    },
  },
});

describe("CTWA manual respeita a unidade do clique", () => {
  it("trocar anúncio remove clique e metadados anteriores, inclusive fallback bruto", async () => {
    const id = await contact({
      source_id: adA,
      ctwa_clid: clickA,
      headline: "Antigo",
      source_url: "https://example.test/old",
      raw: {
        source_id: adA,
        headline: "Não ressuscitar",
        thumbnail_url: "https://example.test/old.png",
      },
    });
    expect((await actions.setLeadAdAction(id, adB)).ok).toBe(true);
    const lead = (await store.getLead(id))!;
    expect(lead.source_id).toBe(adB);
    expect(lead.ctwa_clid).toBeNull();
    expect(lead.headline).toBeNull();
    expect(lead.source_url).toBeNull();
    expect(lead.thumbnail_url).toBeNull();
    expect(
      (lead.raw as Record<string, unknown>)._tracking_snapshot,
    ).toMatchObject({ source_id: adB, ctwa_clid: null });
  });
  it("vincular o mesmo anúncio mantém o clique já registrado", async () => {
    const id = await contact({ source_id: adA, ctwa_clid: clickA });
    expect((await actions.assignLeadAdAction(id, adA)).ok).toBe(true);
    expect((await store.getLead(id))?.ctwa_clid).toBe(clickA);
  });
  it("novo token manual não herda o anúncio de outro contexto", async () => {
    const id = await contact({
      source_id: adA,
      ctwa_clid: clickA,
      raw: { source_id: adA, headline: "Antigo" },
    });
    expect((await actions.setLeadCtwaAction(id, clickB)).ok).toBe(true);
    const lead = (await store.getLead(id))!;
    expect(lead.ctwa_clid).toBe(clickB);
    expect(lead.source_id).toBeNull();
    expect(lead.headline).toBeNull();
  });
  it("a referência mais nova sem token não recebe o clique de uma mensagem antiga", async () => {
    const id = await contact({
      source_id: adB,
      raw: { messages: [referral(adA, clickA), referral(adB)] },
    });
    expect((await actions.pullCtwaFromPhoneAction(id)).ok).toBe(false);
    expect((await store.getLead(id))?.ctwa_clid).toBeNull();
  });
  it("novo contato ao mesmo anúncio sem token não reutiliza o clique anterior", async () => {
    const id = await contact({
      source_id: adA,
      raw: { messages: [referral(adA, clickA), referral(adA)] },
    });
    expect((await actions.pullCtwaFromPhoneAction(id)).ok).toBe(false);
    expect((await store.getLead(id))?.ctwa_clid).toBeNull();
  });
  it("uma referência citada em mensagem do operador não define o clique atual", async () => {
    const id = await contact({
      raw: { messages: [{ ...referral(adA, clickA), fromMe: true }] },
    });
    expect((await actions.pullCtwaFromPhoneAction(id)).ok).toBe(false);
    expect((await store.getLead(id))?.ctwa_clid).toBeNull();
  });
  it("recupera token e anúncio do mesmo contextInfo sem misturar a mensagem anterior", async () => {
    const id = await contact({
      source_id: adB,
      raw: { messages: [referral(adA, clickA), referral(adB, clickB)] },
    });
    const result = await actions.pullCtwaFromPhoneAction(id);
    expect(result.ok).toBe(true);
    expect(result.ctwa_clid).toBe(clickB);
    expect((await store.getLead(id))?.source_id).toBe(adB);
  });
  it("snapshot atual sem CTWA impede resgatar clique antigo ainda presente no bruto", async () => {
    const id = await contact({
      source_id: adA,
      ctwa_clid: clickA,
      raw: { messages: [referral(adA, clickA)] },
    });
    await actions.setLeadAdAction(id, adB);
    expect((await actions.pullCtwaFromPhoneAction(id)).ok).toBe(false);
    expect((await store.getLead(id))?.ctwa_clid).toBeNull();
  });
  it("um registro em outra empresa com o mesmo telefone não fornece CTWA", async () => {
    const id = await contact();
    const lead = (await store.getLead(id))!;
    const other = await store.insertClient({ name: "Outra empresa fictícia" });
    await store.insertLead({
      client_id: other,
      phone: lead.phone,
      source_id: adA,
      ctwa_clid: clickA,
      raw: referral(adA, clickA),
    });
    expect((await actions.pullCtwaFromPhoneAction(id)).ok).toBe(false);
    expect((await store.getLead(id))?.ctwa_clid).toBeNull();
  });
  async function editForm(id: string) {
    const lead = (await store.getLead(id))!;
    const { TRACKING_FIELDS } = await import("@/lib/lead-tracking");
    const fd = new FormData();
    fd.set("id", id);
    fd.set("client_id", lead.client_id);
    fd.set("phone", lead.phone);
    fd.set("name", lead.name || "Nome original");
    for (const key of [
      "ctwa_clid",
      "source_id",
      "source_url",
      "thumbnail_url",
      "media_url",
    ] as const)
      fd.set(key, lead[key] || "");
    fd.set(
      "tracking_baseline",
      JSON.stringify(
        Object.fromEntries(
          TRACKING_FIELDS.map((key) => [key, lead[key] || null]),
        ),
      ),
    );
    return fd;
  }
  async function saveForm(fd: FormData) {
    try {
      return await actions.saveLeadAction({ error: null }, fd);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("TEST_REDIRECT:"))
        return { error: null };
      throw error;
    }
  }
  async function receiveNewReference(id: string) {
    const { withTrackingTouch } = await import("@/lib/lead-tracking");
    await store.updateLeadWithRaw(
      id,
      {},
      withTrackingTouch(
        { provider: "fixture" },
        { source_id: adB, ctwa_clid: clickB },
        "fixture",
        new Date().toISOString(),
      ),
    );
  }
  it("cadastro completo: mudar anúncio não conserva o CTWA que veio inalterado no formulário", async () => {
    const id = await contact({ source_id: adA, ctwa_clid: clickA });
    const fd = await editForm(id);
    fd.set("source_id", adB);
    expect((await saveForm(fd)).error).toBeNull();
    const lead = (await store.getLead(id))!;
    expect(lead.source_id).toBe(adB);
    expect(lead.ctwa_clid).toBeNull();
  });
  it("cadastro completo: mudar CTWA não conserva o anúncio que veio inalterado no formulário", async () => {
    const id = await contact({ source_id: adA, ctwa_clid: clickA });
    const fd = await editForm(id);
    fd.set("ctwa_clid", clickB);
    expect((await saveForm(fd)).error).toBeNull();
    const lead = (await store.getLead(id))!;
    expect(lead.ctwa_clid).toBe(clickB);
    expect(lead.source_id).toBeNull();
  });
  it("salvar apenas perfil em formulário antigo preserva referência recebida depois", async () => {
    const id = await contact({ source_id: adA, ctwa_clid: clickA });
    const fd = await editForm(id);
    fd.set("name", "Nome atualizado");
    await receiveNewReference(id);
    expect((await saveForm(fd)).error).toBeNull();
    const lead = (await store.getLead(id))!;
    expect(lead.name).toBe("Nome atualizado");
    expect(lead.source_id).toBe(adB);
    expect(lead.ctwa_clid).toBe(clickB);
  });
  it("editar referência em formulário antigo rejeita conflito sem salvar perfil parcialmente", async () => {
    const id = await contact({
      name: "Original",
      source_id: adA,
      ctwa_clid: clickA,
    });
    const fd = await editForm(id);
    fd.set("name", "Não salvar");
    fd.set("source_id", "120000000003");
    await receiveNewReference(id);
    expect((await saveForm(fd)).error).toMatch(/mudou|Recarregue/);
    const lead = (await store.getLead(id))!;
    expect(lead.name).toBe("Original");
    expect(lead.source_id).toBe(adB);
    expect(lead.ctwa_clid).toBe(clickB);
  });
  it("mudar empresa sem conversões limpa a referência Meta da empresa anterior", async () => {
    const id = await contact({ source_id: adA, ctwa_clid: clickA });
    const fd = await editForm(id);
    const next = await store.insertClient({ name: "Novo contexto" });
    fd.set("client_id", next);
    expect((await saveForm(fd)).error).toBeNull();
    const lead = (await store.getLead(id))!;
    expect(lead.client_id).toBe(next);
    expect(lead.source_id).toBeNull();
    expect(lead.ctwa_clid).toBeNull();
  });
  it("novos anúncio e CTWA digitados juntos ficam no mesmo snapshot", async () => {
    const id = await contact({ source_id: adA, ctwa_clid: clickA });
    const fd = await editForm(id);
    fd.set("ctwa_clid", clickB);
    fd.set("source_id", adB);
    expect((await saveForm(fd)).error).toBeNull();
    const lead = (await store.getLead(id))!;
    expect(lead.source_id).toBe(adB);
    expect(lead.ctwa_clid).toBe(clickB);
    expect(
      (lead.raw as Record<string, unknown>)._tracking_snapshot,
    ).toMatchObject({ source_id: adB, ctwa_clid: clickB });
  });
  it("cliente desconhecido ou CTWA sintético é rejeitado sem alterar o contato", async () => {
    const id = await contact({ source_id: adA, ctwa_clid: clickA });
    const fd = await editForm(id);
    fd.set("client_id", "unknown");
    expect((await saveForm(fd)).error).toMatch(/Cliente não encontrado/);
    fd.set("client_id", client);
    fd.set("ctwa_clid", "ctwa_ad_120000000001");
    expect((await saveForm(fd)).error).toMatch(/CTWA Click ID inválido/);
    expect((await store.getLead(id))?.ctwa_clid).toBe(clickA);
  });

  it("novo cadastro grava CTWA e anúncio juntos no snapshot inicial", async () => {
    const fd = new FormData();
    fd.set("client_id", client);
    fd.set("phone", "5511987654321");
    fd.set("name", "Novo contato fictício");
    fd.set("source_id", adB);
    fd.set("ctwa_clid", clickB);
    expect((await saveForm(fd)).error).toBeNull();
    const lead = (await store.findLead(client, "5511987654321"))!;
    expect(lead.source_id).toBe(adB);
    expect(lead.ctwa_clid).toBe(clickB);
    expect(lead.origin).toBe("manual");
    expect(
      (lead.raw as Record<string, unknown>)._tracking_snapshot,
    ).toMatchObject({ source_id: adB, ctwa_clid: clickB, provider: "manual" });
  });
});
