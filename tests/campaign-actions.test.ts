import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const graph = vi.hoisted(() => ({
  ads: vi.fn(),
  campaigns: vi.fn(),
  individualAd: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  requireAuth: async () => {},
  login: async () => true,
  logout: async () => {},
  startSession: async () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/meta", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/meta")>()),
  fetchAdAccountAdsAndInsights: graph.ads,
  fetchAdAccountCampaigns: graph.campaigns,
  fetchAd: graph.individualAd,
}));
let store: typeof import("@/lib/store");
let actions: typeof import("@/app/actions");
let client: string;
let directory: string;
let saved: Record<string, string | undefined>;
const campaign = {
  id: "120000000001",
  name: "Ativa QA",
  status: "ACTIVE",
  effective_status: "ACTIVE",
};
const result = {
  ok: true,
  accountId: "act_123456",
  campaigns: [campaign],
  partial: false,
  warnings: [],
  ads: [],
};
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
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "track-campaign-actions-"));
  process.env.TRACK_DATA_DIR = directory;
  for (const key of [
    "DATABASE_URL",
    "SUPABASE_DATABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "APP_SECRET",
  ])
    delete process.env[key];
  store = await import("@/lib/store");
  actions = await import("@/app/actions");
  const { encrypt } = await import("@/lib/crypto");
  const { appSecret } = await import("@/lib/config");
  client = await store.insertClient({
    name: "Campanhas QA",
    ad_account_id: "act_123456",
    marketing_token_enc: encrypt("fixture-read-token", await appSecret()),
  });
});
beforeEach(() => {
  vi.clearAllMocks();
  graph.ads.mockResolvedValue(result);
  graph.campaigns.mockResolvedValue(result);
});
afterAll(() => {
  try {
    (globalThis as any).__trackDb?.close?.();
    delete (globalThis as any).__trackDb;
    delete (globalThis as any).__trackDbPath;
    fs.rmSync(directory, { recursive: true, force: true });
  } catch {}
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
describe("sincronização autorizada das campanhas", () => {
  it("usa somente ativas por padrão e não recorre a anúncios de leads fora do filtro", async () => {
    await store.insertLead({
      client_id: client,
      phone: "5511999000011",
      source_id: "999999999999",
    });
    const response = await actions.syncDashboardMetaAction(client);
    expect(response.ok).toBe(true);
    expect(response.syncedCount).toBe(0);
    expect(graph.ads).toHaveBeenCalledWith(
      expect.objectContaining({
        adAccountId: "act_123456",
        campaignStatus: "active",
        campaignIds: [],
      }),
    );
    expect(graph.individualAd).not.toHaveBeenCalled();
  });
  it("transmite status e seleção explícitos e indexa anúncios mesmo sem contatos", async () => {
    graph.ads.mockResolvedValue({
      ...result,
      ads: [
        {
          raw: { item: { id: "130000000001" } },
          campaign_id: campaign.id,
          campaign_name: campaign.name,
          ad_name: "Anúncio QA",
        },
      ],
    });
    const response = await actions.syncDashboardMetaAction(client, {
      campaignStatus: "paused",
      campaignIds: [campaign.id, campaign.id],
    });
    expect(response.ok).toBe(true);
    expect(graph.ads).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignStatus: "paused",
        campaignIds: [campaign.id],
      }),
    );
    expect((await store.getAd(client, "130000000001"))?.ad_name).toBe(
      "Anúncio QA",
    );
    expect(
      JSON.parse((await store.getSetting(`meta_synced_ad_ids_${client}`))!)
        .adIds,
    ).toContain("130000000001");
  });
  it("carrega catálogo de todos os status para o seletor sem importar anúncios", async () => {
    const response = await actions.loadDashboardCampaignsAction(client);
    expect(response.ok).toBe(true);
    expect(response.campaignsLoaded).toBe(1);
    expect(graph.campaigns).toHaveBeenCalledWith(
      expect.objectContaining({ campaignStatus: "all" }),
    );
    expect(graph.ads).not.toHaveBeenCalled();
    expect(
      JSON.parse((await store.getSetting(`meta_campaign_catalog_${client}`))!)
        .campaigns[0].id,
    ).toBe(campaign.id);
  });
  it("rejeita seleção inválida antes da rede", async () => {
    expect(
      (
        await actions.syncDashboardMetaAction(client, {
          campaignIds: ["invalid"],
        })
      ).ok,
    ).toBe(false);
    expect(graph.ads).not.toHaveBeenCalled();
  });
  it("exige empresa para seleção específica e não tenta IDs em outras contas", async () => {
    const response = await actions.syncDashboardMetaAction(null, {
      campaignIds: [campaign.id],
    });
    expect(response.ok).toBe(false);
    expect(response.message).toContain("Selecione uma empresa");
    expect(graph.ads).not.toHaveBeenCalled();
  });
  it("não declara sucesso completo quando a Meta devolve resultados parciais", async () => {
    graph.ads.mockResolvedValue({
      ...result,
      partial: true,
      warnings: ["Consulta parcial: limite atingido."],
    });
    const response = await actions.syncDashboardMetaAction(client);
    expect(response.ok).toBe(false);
    expect(response.message).toContain("parcial");
    expect(
      JSON.parse((await store.getSetting(`meta_campaign_catalog_${client}`))!)
        .partial,
    ).toBe(true);
  });
});
