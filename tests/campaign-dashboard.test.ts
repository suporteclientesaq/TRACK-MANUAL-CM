import { describe, expect, it } from "vitest";
import { buildDashboardData, type DashboardSnapshot } from "@/lib/dashboard";
import type { AdInfo, Client, EventRow, Lead } from "@/lib/types";
const at = "2026-11-09T12:00:00Z";
const now = new Date("2026-11-09T14:00:00Z");
const client = {
  id: "c",
  name: "Cliente fictício",
  default_currency: "BRL",
  ad_account_id: "act_123",
  created_at: at,
  updated_at: at,
} as Client;
const campaign = (id: string, status = "ACTIVE") => ({
  id,
  name: `Campanha ${id}`,
  status,
  effective_status: status,
});
const ad = (id: string, campaignId: string, status = "ACTIVE"): AdInfo =>
  ({
    client_id: "c",
    ad_id: id,
    ad_name: `Anúncio ${id}`,
    ad_status: status,
    campaign_id: campaignId,
    campaign_name: `Campanha ${campaignId}`,
    adset_id: `4${id}`,
    adset_name: `Conjunto ${id}`,
    fetched_at: at,
    spend: 999,
    raw: {
      account_id: "act_123",
      item: {
        campaign: campaign(campaignId),
        adset: { effective_status: "PAUSED" },
      },
    },
  }) as AdInfo;
const lead = {
  id: "l",
  client_id: "c",
  phone: "5511999990001",
  name: "Fictício",
  source_id: "2001",
  first_seen_at: at,
  raw: { messages: [] },
} as unknown as Lead;
const sale = {
  id: "e",
  event_id: "purchase-one",
  client_id: "c",
  lead_id: "l",
  event_name: "Purchase",
  event_time: at,
  status: "enviado",
  is_test: false,
  value: 80,
  currency: "BRL",
  payload: { data: [{ custom_data: { ctwa_source_id: "2001" } }] },
} as EventRow;
const snapshot = (): DashboardSnapshot => ({
  clients: [client],
  leads: [lead],
  events: [sale],
  ads: [ad("2001", "1001", "PAUSED"), ad("2002", "1002")],
  campaignCatalogs: [
    {
      clientId: "c",
      accountId: "act_123",
      syncedAt: at,
      campaigns: [
        campaign("1001"),
        campaign("1002", "PAUSED"),
        campaign("1003"),
      ],
    },
  ],
});

describe("seleção de campanhas no desempenho do dashboard", () => {
  it("padrão ativo usa status da campanha e inclui campanhas sem contatos", () => {
    const result = buildDashboardData(snapshot(), { period: "hoje" }, now);
    expect(result.filterCampaignStatus).toBe("active");
    expect(result.campaigns.map((item) => item.campaign_id)).toEqual([
      "1001",
      "1003",
    ]);
    expect(result.ads.map((item) => item.id)).toEqual(["c:2001:BRL"]);
    expect(result.ads[0].status).toBe("PAUSED");
    expect(result.adsets[0].status).toBe("PAUSED");
    expect(result.campaignOptions).toHaveLength(3);
    expect(result.campaignCatalogSyncedAt).toBe(at);
  });
  it("campanha pausada não é confundida com seu anúncio ativo", () => {
    const result = buildDashboardData(
      snapshot(),
      { period: "hoje", campaignStatus: "paused" },
      now,
    );
    expect(result.campaigns.map((item) => item.campaign_id)).toEqual(["1002"]);
    expect(result.ads[0].status).toBe("ACTIVE");
  });
  it("seleção filtra tabelas por Meta ID sem retirar receita global e orgânica", () => {
    const base = snapshot();
    base.leads.push({
      ...lead,
      id: "organic",
      phone: "5511999990002",
      source_id: null,
    });
    const result = buildDashboardData(
      base,
      { period: "hoje", campaignStatus: "all", campaignIds: ["1003"] },
      now,
    );
    expect(result.campaigns.map((item) => item.campaign_id)).toEqual(["1003"]);
    expect(result.ads).toHaveLength(0);
    expect(result.adsets).toHaveLength(0);
    expect(result.kpis.revenue).toBe(80);
    expect(result.kpis.leads).toBe(2);
    expect(result.filterCampaignIds).toEqual(["1003"]);
  });
  it("catálogo da conta anterior não aparece como campanha ativa", () => {
    const base = snapshot();
    base.campaignCatalogs![0].accountId = "act_999";
    for (const cached of base.ads)
      (cached.raw as Record<string, unknown>).account_id = "act_999";
    const result = buildDashboardData(base, { period: "hoje" }, now);
    expect(result.campaigns).toHaveLength(0);
    expect(result.campaignCatalogWarnings.join(" ")).toMatch(/outra conta/);
  });
  it("catálogo atual vazio impede ressuscitar status ativo antigo do cache", () => {
    const base = snapshot();
    base.campaignCatalogs![0].campaigns = [];
    const result = buildDashboardData(base, { period: "hoje" }, now);
    expect(result.campaigns).toHaveLength(0);
    expect(result.ads).toHaveLength(0);
    const all = buildDashboardData(
      base,
      { period: "hoje", campaignStatus: "all" },
      now,
    );
    expect(all.campaigns.every((item) => item.status === "UNKNOWN")).toBe(true);
  });
  it("ausência do status da campanha não herda o status de anúncio ativo", () => {
    const base = snapshot();
    base.campaignCatalogs = [];
    for (const cached of base.ads)
      cached.raw = { account_id: "act_123", item: {} };
    const result = buildDashboardData(base, { period: "hoje" }, now);
    expect(result.campaigns).toHaveLength(0);
    expect(
      result.campaignOptions.every(
        (item) => item.status === null && item.effective_status === null,
      ),
    ).toBe(true);
  });
  it("o filtro comercial não converte gasto lifetime em gasto de período", () => {
    const result = buildDashboardData(
      snapshot(),
      { period: "hoje", campaignStatus: "all" },
      now,
    );
    expect(result.kpis.spend).toBeNull();
    expect(result.kpis.roas).toBeNull();
    expect(
      result.campaigns.every((row) => row.spend === null && row.roas === null),
    ).toBe(true);
  });
});
