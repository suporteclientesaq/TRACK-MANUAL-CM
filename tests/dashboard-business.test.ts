import { describe, expect, it } from "vitest";
import {
  buildDashboardData,
  getPeriodRange,
  type DashboardSnapshot,
} from "@/lib/dashboard";
import type { Client, EventRow, Lead, AdInfo } from "@/lib/types";
const now = new Date("2026-11-09T14:00:00Z");
const at = "2026-11-09T12:00:00Z";
const client = (id = "c", currency = "BRL") =>
  ({
    id,
    name: "Fixture " + id,
    default_currency: currency,
    created_at: at,
    updated_at: at,
  }) as Client;
const lead = (id = "l", clientId = "c") =>
  ({
    id,
    client_id: clientId,
    name: "Contato fictício",
    phone: "5511999990001",
    country: "br",
    source_id: "120210001002",
    raw: { messages: [] },
    first_seen_at: at,
    updated_at: at,
  }) as unknown as Lead;
const event = (id: string, name = "Purchase", value = 60, test = false) =>
  ({
    id,
    client_id: "c",
    lead_id: "l",
    event_name: name,
    event_id: id,
    event_time: at,
    value,
    currency: "BRL",
    is_test: test,
    status: "enviado",
    created_at: at,
    payload: { data: [{ custom_data: { ctwa_source_id: "120210001001" } }] },
  }) as EventRow;
const ad = (id: string) =>
  ({
    client_id: "c",
    ad_id: id,
    ad_name: id,
    campaign_id: id,
    campaign_name: id,
    raw: {
      item: {
        campaign: {
          id,
          name: id,
          status: "ACTIVE",
          effective_status: "ACTIVE",
        },
      },
    },
    spend: 1000,
    fetched_at: at,
  }) as AdInfo;
const snapshot = (
  events: EventRow[] = [],
  leads: Lead[] = [lead()],
): DashboardSnapshot => ({
  clients: [client()],
  leads,
  events,
  ads: [ad("120210001001"), ad("120210001002")],
});
describe("indicadores comerciais", () => {
  it("receita considera somente Purchase em produção", () => {
    const result = buildDashboardData(
      snapshot([
        event("test", "Purchase", 100, true),
        event("checkout", "InitiateCheckout", 40),
        event("real", "Purchase", 60),
      ]),
      { period: "hoje" },
      now,
    );
    expect(result.kpis.revenue).toBe(60);
    expect(result.kpis.purchases).toBe(1);
    expect(result.dataQuality.excludedTestEvents).toBe(1);
  });
  it("tentativas com o mesmo event_id contam uma só compra", () => {
    const original = event("sale");
    const duplicate = {
      ...original,
      id: "retry",
      created_at: "2026-11-09T12:05:00Z",
    };
    const result = buildDashboardData(
      snapshot([original, duplicate]),
      { period: "hoje" },
      now,
    );
    expect(result.kpis.revenue).toBe(60);
    expect(result.kpis.purchases).toBe(1);
  });
  it("não inventa gasto diário, ROAS, respostas ou propostas", () => {
    const result = buildDashboardData(snapshot(), { period: "hoje" }, now);
    expect(result.kpis.spend).toBeNull();
    expect(result.kpis.roas).toBeNull();
    expect(
      result.chart.every((day) => day.spend === null && day.roas === null),
    ).toBe(true);
    expect(result.funnel.slice(1).every((step) => step.count === 0)).toBe(true);
  });
  it("lead orgânico entra no total de contatos", () => {
    const organic = { ...lead(), source_id: null, ctwa_clid: null };
    const result = buildDashboardData(
      snapshot([], [organic]),
      { period: "hoje" },
      now,
    );
    expect(result.kpis.leads).toBe(1);
  });
  it("usa a referência salva no evento e não o anúncio atual do lead", () => {
    const result = buildDashboardData(
      snapshot([event("sale")]),
      { period: "hoje" },
      now,
    );
    expect(
      result.campaigns.find((campaign) => campaign.name === "120210001001")
        ?.revenue,
    ).toBe(60);
    expect(
      result.campaigns.find((campaign) => campaign.name === "120210001002")
        ?.revenue || 0,
    ).toBe(0);
  });
  it("mantém moedas separadas em vez de somar reais e dólares", () => {
    const data = snapshot(
      [
        event("brl"),
        { ...event("usd"), client_id: "d", lead_id: "ld", currency: "USD" },
      ],
      [lead(), lead("ld", "d")],
    );
    data.clients.push(client("d", "USD"));
    const result = buildDashboardData(data, { period: "hoje" }, now);
    expect(result.kpis.revenue).toBeNull();
    expect(result.revenueByCurrency.map((item) => item.currency)).toEqual([
      "BRL",
      "USD",
    ]);
  });
  it("hoje usa o dia de São Paulo perto da virada UTC", () => {
    const range = getPeriodRange("hoje", new Date("2026-11-09T01:30:00Z"));
    expect(range.start.toISOString()).toBe("2026-11-08T03:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-11-09T02:59:59.999Z");
  });
});
