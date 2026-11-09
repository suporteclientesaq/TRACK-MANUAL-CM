import "server-only";
import {
  adsFor,
  getSetting,
  listClients,
  listEvents,
  listLeads,
} from "./store";
import {
  matchesCampaignStatus,
  type CampaignStatusFilter,
  type MetaCampaign,
} from "./meta";
import { phoneVariants } from "./normalize";
import type { AdInfo, Client, EventRow, Lead } from "./types";

export interface DashboardFilter {
  clientId?: string | null;
  campaignStatus?: CampaignStatusFilter;
  campaignIds?: string[];
  period?: "hoje" | "ontem" | "7d" | "30d" | "mes" | "todos" | string | null;
}

export interface DailyPoint {
  date: string;
  label: string;
  spend: number | null;
  revenue: number | null;
  sales: number;
  leads: number;
  roas: number | null;
}

export interface CampaignMetric {
  id: string;
  name: string;
  client_name: string;
  client_id: string;
  campaign_id: string | null;
  currency: string;
  status: string;
  spend: number | null;
  leads: number;
  purchases: number;
  revenue: number;
  cpa: number | null;
  roas: number | null;
}

export interface AdSetMetric extends Omit<CampaignMetric, "cpa"> {
  campaign_name: string;
}

export interface AdCreativeMetric extends Omit<
  CampaignMetric,
  "cpa" | "leads"
> {
  thumbnail_url: string | null;
  creative_title: string | null;
  campaign_name: string;
  adset_name: string;
  conversations: number;
}

export interface FunnelStep {
  name: string;
  count: number;
  percent: number;
}

export interface DashboardData {
  currency: string;
  filterPeriod: string;
  filterClient: string | null;
  filterCampaignStatus: CampaignStatusFilter;
  filterCampaignIds: string[];
  campaignOptions: {
    id: string;
    name: string;
    clientId: string;
    clientName: string;
    status: string | null;
    effective_status: string | null;
  }[];
  campaignCatalogSyncedAt: string | null;
  campaignCatalogWarnings: string[];
  periodLabel: string;
  rangeLabel: string;
  generatedAt: string;
  attributionNote: string;
  revenueByCurrency: { currency: string; value: number }[];
  unattributedPurchases: number;
  dataQuality: {
    hasPeriodSpend: boolean;
    partial: boolean;
    excludedTestEvents: number;
    duplicateAttempts: number;
    attributionCoverage: number;
    chartLimited: boolean;
  };
  kpis: {
    revenue: number | null;
    spend: number | null;
    profit: number | null;
    roas: number | null;
    roiPercent: number | null;
    purchases: number;
    leads: number;
    averageTicket: number | null;
    costPerLead: number | null;
    cpa: number | null;
    conversionRate: number;
  };
  chart: DailyPoint[];
  campaigns: CampaignMetric[];
  adsets: AdSetMetric[];
  ads: AdCreativeMetric[];
  funnel: FunnelStep[];
  clients: { id: string; name: string }[];
}

const TIME_ZONE = "America/Sao_Paulo";
const DAY = 86_400_000;
const PERIOD_LABELS: Record<string, string> = {
  hoje: "Hoje",
  ontem: "Ontem",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  mes: "Este mês",
  todos: "Todo o histórico",
};

/** All dashboard dates use the same Brazilian business timezone, not the server's locale. */
function dateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find((p) => p.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function shiftDate(key: string, days: number): string {
  return new Date(new Date(`${key}T12:00:00Z`).getTime() + days * DAY)
    .toISOString()
    .slice(0, 10);
}

// São Paulo has used UTC-03 continuously since 2019, the interval supported by this app.
function dayStart(key: string): Date {
  return new Date(`${key}T00:00:00-03:00`);
}
function dayEnd(key: string): Date {
  return new Date(`${key}T23:59:59.999-03:00`);
}

export function getPeriodRange(
  period: string,
  now = new Date(),
): { start: Date; end: Date } {
  const today = dateKey(now);
  const match = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/.exec(period);
  if (match && match[1] <= match[2]) {
    const start = dayStart(match[1]);
    const end = dayEnd(match[2]);
    if (
      Number.isFinite(start.getTime()) &&
      Number.isFinite(end.getTime()) &&
      dateKey(start) === match[1] &&
      dateKey(end) === match[2]
    )
      return { start, end };
  }
  switch (period) {
    case "hoje":
      return { start: dayStart(today), end: dayEnd(today) };
    case "ontem":
      return {
        start: dayStart(shiftDate(today, -1)),
        end: dayEnd(shiftDate(today, -1)),
      };
    case "7d":
      return { start: dayStart(shiftDate(today, -6)), end: dayEnd(today) };
    case "mes":
      return { start: dayStart(`${today.slice(0, 7)}-01`), end: dayEnd(today) };
    case "todos":
      return { start: dayStart("2020-01-01"), end: dayEnd(today) };
    default:
      return { start: dayStart(shiftDate(today, -29)), end: dayEnd(today) };
  }
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const finite = (value: number | null): number =>
  value !== null && Number.isFinite(value) ? value : 0;
const roundMoney = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;
const inRange = (iso: string, start: Date, end: Date): boolean => {
  const value = new Date(iso).getTime();
  return (
    Number.isFinite(value) && value >= start.getTime() && value <= end.getTime()
  );
};
const contactKey = (lead: Lead): string =>
  `${lead.client_id}:${phoneVariants(lead.phone).sort().at(-1) || lead.phone}`;

/** A sale uses its saved payload. Later edits to a lead must never reattribute an old sale. */
function savedAdId(event: EventRow): string | null {
  const payload = record(event.payload);
  const first = Array.isArray(payload.data)
    ? record(payload.data[0])
    : record(payload.event);
  const custom = record(first.custom_data);
  const saved = custom.ctwa_source_id;
  return typeof saved === "string" && /^\d+$/.test(saved) ? saved : null;
}

function respondedInPeriod(lead: Lead, start: Date, end: Date): boolean {
  const messages = record(lead.raw).messages;
  return (
    Array.isArray(messages) &&
    messages.some((value: unknown) => {
      const message = record(value);
      return (
        (message.fromMe === true || message.direction === "outbound") &&
        typeof message.at === "string" &&
        inRange(message.at, start, end)
      );
    })
  );
}

export interface DashboardCampaignCatalog {
  clientId: string;
  accountId?: string;
  campaigns: MetaCampaign[];
  syncedAt?: string;
  partial?: boolean;
  warnings?: string[];
}

const accountKey = (value: string | null | undefined): string | null => {
  const raw = (value || "").trim();
  return /^(?:act_)?\d+$/.test(raw) ? `act_${raw.replace(/^act_/, "")}` : null;
};
function campaignFromAd(ad: AdInfo): Record<string, unknown> {
  const raw = record(ad.raw);
  return record(record(raw.item || raw.ad).campaign);
}
function adSetFromAd(ad: AdInfo): Record<string, unknown> {
  const raw = record(ad.raw);
  return record(record(raw.item || raw.ad).adset);
}
const ownStatus = (value: Record<string, unknown>): string =>
  typeof value.effective_status === "string"
    ? value.effective_status
    : typeof value.status === "string"
      ? value.status
      : "UNKNOWN";

export interface DashboardSnapshot {
  clients: Client[];
  leads: Lead[];
  events: EventRow[];
  ads: AdInfo[];
  campaignCatalogs?: DashboardCampaignCatalog[];
  partial?: boolean;
}

/** Pure aggregation is also used by the regression suite, without any network connection. */
export function buildDashboardData(
  snapshot: DashboardSnapshot,
  filter: DashboardFilter = {},
  now = new Date(),
): DashboardData {
  const period = filter.period || "30d";
  const { start, end } = getPeriodRange(period, now);
  const clients = snapshot.clients.filter(
    (client) => !filter.clientId || client.id === filter.clientId,
  );
  const clientMap = new Map(clients.map((client) => [client.id, client]));
  const leads = snapshot.leads.filter((lead) => clientMap.has(lead.client_id));
  const periodLeads = leads.filter((lead) =>
    inRange(lead.first_seen_at, start, end),
  );
  const uniqueLeads = new Map(
    periodLeads.map((lead) => [contactKey(lead), lead]),
  );
  const leadMap = new Map(leads.map((lead) => [lead.id, lead]));
  const receivedEvents = snapshot.events.filter(
    (event) =>
      clientMap.has(event.client_id) &&
      event.status === "enviado" &&
      inRange(event.event_time, start, end),
  );
  const productionEvents = receivedEvents.filter((event) => !event.is_test);
  const uniqueEvents = new Map<string, EventRow>();
  for (const event of productionEvents) {
    const key = `${event.client_id}:${event.event_name.toLowerCase()}:${event.event_id || event.id}`;
    if (!uniqueEvents.has(key)) uniqueEvents.set(key, event);
  }
  const events = [...uniqueEvents.values()];
  const sales = events.filter(
    (event) => event.event_name.toLowerCase() === "purchase",
  );
  const currencyFor = (event: EventRow) =>
    (
      event.currency ||
      clientMap.get(event.client_id)?.default_currency ||
      "BRL"
    ).toUpperCase();
  const revenueByCurrencyMap = new Map<string, number>();
  for (const event of sales)
    revenueByCurrencyMap.set(
      currencyFor(event),
      (revenueByCurrencyMap.get(currencyFor(event)) || 0) + finite(event.value),
    );
  const revenueByCurrency = [...revenueByCurrencyMap]
    .map(([currency, value]) => ({ currency, value: roundMoney(value) }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
  const configuredCurrencies = [
    ...new Set(clients.map((client) => client.default_currency.toUpperCase())),
  ];
  const currency =
    revenueByCurrency.length === 1
      ? revenueByCurrency[0].currency
      : configuredCurrencies[0] || "BRL";
  const mixedCurrencies = revenueByCurrency.length > 1;
  const revenue = mixedCurrencies ? null : revenueByCurrency[0]?.value || 0;
  const adMap = new Map(
    snapshot.ads.map((ad) => [`${ad.client_id}:${ad.ad_id}`, ad]),
  );
  const campaignStatus: CampaignStatusFilter =
    filter.campaignStatus === "all" || filter.campaignStatus === "paused"
      ? filter.campaignStatus
      : "active";
  const campaignIds = [
    ...new Set((filter.campaignIds || []).filter((id) => /^\d+$/.test(id))),
  ];
  const selectedIds = new Set(campaignIds);
  const catalogMap = new Map<string, MetaCampaign>();
  const catalogClients = new Set<string>();
  const catalogWarnings: string[] = [];
  const catalogDates: string[] = [];
  for (const catalog of snapshot.campaignCatalogs || []) {
    const client = clientMap.get(catalog.clientId);
    if (!client) continue;
    const expected = accountKey(client.ad_account_id);
    if (expected && accountKey(catalog.accountId) !== expected) {
      catalogWarnings.push(
        `${client.name}: o catálogo pertence a outra conta de anúncios. Atualize a lista de campanhas.`,
      );
      continue;
    }
    catalogClients.add(client.id);
    if (catalog.syncedAt && Number.isFinite(Date.parse(catalog.syncedAt)))
      catalogDates.push(catalog.syncedAt);
    if (catalog.partial)
      catalogWarnings.push(
        `${client.name}: o catálogo de campanhas está incompleto.`,
      );
    catalogWarnings.push(
      ...(catalog.warnings || []).map(
        (message) => `${client.name}: ${message}`,
      ),
    );
    for (const campaign of catalog.campaigns)
      if (/^\d+$/.test(campaign.id))
        catalogMap.set(`${client.id}:${campaign.id}`, campaign);
  }
  const campaignInfo = (
    client: Client,
    ad: AdInfo | undefined,
  ): MetaCampaign | null => {
    const id = ad?.campaign_id;
    if (!id) return null;
    const cached = catalogMap.get(`${client.id}:${id}`);
    if (cached) return cached;
    const raw = record(ad?.raw);
    const expected = accountKey(client.ad_account_id);
    const sourceAccount = accountKey(
      typeof raw.account_id === "string"
        ? raw.account_id
        : String(record(raw.item || raw.ad).account_id || ""),
    );
    const verified =
      !catalogClients.has(client.id) &&
      (!expected || sourceAccount === expected);
    const source = verified && ad ? campaignFromAd(ad) : {};
    return {
      id,
      name: ad?.campaign_name || `Campanha ${id}`,
      status: typeof source.status === "string" ? source.status : null,
      effective_status:
        typeof source.effective_status === "string"
          ? source.effective_status
          : null,
    };
  };
  const options = new Map<
    string,
    {
      id: string;
      name: string;
      clientId: string;
      clientName: string;
      status: string | null;
      effective_status: string | null;
    }
  >();
  for (const [key, campaign] of catalogMap) {
    const client = clientMap.get(key.slice(0, key.indexOf(":")))!;
    options.set(key, {
      ...campaign,
      clientId: client.id,
      clientName: client.name,
    });
  }
  for (const ad of snapshot.ads) {
    const client = clientMap.get(ad.client_id);
    if (!client) continue;
    const info = campaignInfo(client, ad);
    if (info && !options.has(`${client.id}:${info.id}`))
      options.set(`${client.id}:${info.id}`, {
        ...info,
        clientId: client.id,
        clientName: client.name,
      });
  }
  const adLeads = new Map<string, Set<string>>();
  for (const lead of periodLeads)
    if (lead.source_id) {
      const key = `${lead.client_id}:${lead.source_id}`;
      const contacts = adLeads.get(key) || new Set<string>();
      contacts.add(contactKey(lead));
      adLeads.set(key, contacts);
    }
  const adSales = new Map<string, EventRow[]>();
  let attributedPurchases = 0;
  for (const sale of sales) {
    const adId = savedAdId(sale);
    if (!adId) continue;
    const key = `${sale.client_id}:${adId}`;
    adSales.set(key, [...(adSales.get(key) || []), sale]);
    attributedPurchases++;
  }
  const campaigns = new Map<string, CampaignMetric>();
  const adsets = new Map<string, AdSetMetric>();
  const ads: AdCreativeMetric[] = [];
  for (const [key, info] of options) {
    const client = clientMap.get(info.clientId)!;
    const currency = client.default_currency.toUpperCase();
    const id = `${key}:${currency}`;
    campaigns.set(id, {
      id,
      name: info.name,
      client_id: client.id,
      client_name: client.name,
      campaign_id: info.id,
      currency,
      status: info.effective_status || info.status || "UNKNOWN",
      spend: null,
      leads: 0,
      purchases: 0,
      revenue: 0,
      cpa: null,
      roas: null,
    });
  }
  const keys = new Set([...adLeads.keys(), ...adSales.keys(), ...adMap.keys()]);
  for (const key of keys) {
    const separator = key.indexOf(":");
    const clientId = key.slice(0, separator);
    const adId = key.slice(separator + 1);
    const client = clientMap.get(clientId);
    if (!client) continue;
    const ad = adMap.get(key);
    const linkedSales = adSales.get(key) || [];
    // Keep financial rows separated even if a client records sales in several currencies.
    const currencies = new Set(linkedSales.map(currencyFor));
    if (!currencies.size) currencies.add(client.default_currency.toUpperCase());
    for (const rowCurrency of currencies) {
      const rowSales = linkedSales.filter(
        (event) => currencyFor(event) === rowCurrency,
      );
      const rowRevenue = roundMoney(
        rowSales.reduce((sum, sale) => sum + finite(sale.value), 0),
      );
      const leadsCount =
        rowCurrency === client.default_currency.toUpperCase()
          ? adLeads.get(key)?.size || 0
          : 0;
      const campaignMeta = campaignInfo(client, ad);
      const campaignName =
        campaignMeta?.name || ad?.campaign_name || "Campanha não identificada";
      const adsetName = ad?.adset_name || "Conjunto não identificado";
      const campaignId = `${clientId}:${ad?.campaign_id || ad?.campaign_name || `ad_${adId}`}:${rowCurrency}`;
      const adsetId = `${clientId}:${ad?.adset_id || ad?.adset_name || `ad_${adId}`}:${rowCurrency}`;
      const campaign = campaigns.get(campaignId) || {
        id: campaignId,
        name: campaignName,
        client_name: client.name,
        client_id: clientId,
        campaign_id: ad?.campaign_id || null,
        currency: rowCurrency,
        status:
          campaignMeta?.effective_status || campaignMeta?.status || "UNKNOWN",
        spend: null,
        leads: 0,
        purchases: 0,
        revenue: 0,
        cpa: null,
        roas: null,
      };
      campaign.leads += leadsCount;
      campaign.purchases += rowSales.length;
      campaign.revenue = roundMoney(campaign.revenue + rowRevenue);
      campaigns.set(campaignId, campaign);
      const adset = adsets.get(adsetId) || {
        id: adsetId,
        name: adsetName,
        client_name: client.name,
        currency: rowCurrency,
        campaign_name: campaignName,
        campaign_id: ad?.campaign_id || null,
        client_id: clientId,
        status: ad ? ownStatus(adSetFromAd(ad)) : "UNKNOWN",
        spend: null,
        leads: 0,
        purchases: 0,
        revenue: 0,
        roas: null,
      };
      adset.leads += leadsCount;
      adset.purchases += rowSales.length;
      adset.revenue = roundMoney(adset.revenue + rowRevenue);
      adsets.set(adsetId, adset);
      ads.push({
        id: `${key}:${rowCurrency}`,
        name: ad?.ad_name || `Anúncio ${adId.slice(-6)}`,
        client_name: client.name,
        currency: rowCurrency,
        thumbnail_url: ad?.thumbnail_url || null,
        creative_title: ad?.creative_title || null,
        campaign_name: campaignName,
        adset_name: adsetName,
        campaign_id: ad?.campaign_id || null,
        client_id: clientId,
        status: ad?.ad_status || "UNKNOWN",
        spend: null,
        conversations: leadsCount,
        purchases: rowSales.length,
        revenue: rowRevenue,
        roas: null,
      });
    }
  }
  const buyers = new Set(
    sales.flatMap((sale) => {
      const lead = leadMap.get(sale.lead_id);
      return lead && lead.client_id === sale.client_id
        ? [contactKey(lead)]
        : [];
    }),
  );
  const cohortBuyers = [...uniqueLeads.keys()].filter((key) =>
    buyers.has(key),
  ).length;
  const answered = new Set(
    periodLeads
      .filter((lead) => respondedInPeriod(lead, start, end))
      .map(contactKey),
  );
  const checkout = new Set(
    events
      .filter((event) => event.event_name.toLowerCase() === "initiatecheckout")
      .flatMap((event) => {
        const lead = leadMap.get(event.lead_id);
        return lead &&
          uniqueLeads.has(contactKey(lead)) &&
          lead.client_id === event.client_id
          ? [contactKey(lead)]
          : [];
      }),
  );
  const funnelCounts: [string, number][] = [
    ["Novos contatos", uniqueLeads.size],
    ["Receberam resposta", answered.size],
    ["Iniciaram checkout", checkout.size],
    ["Compraram", cohortBuyers],
  ];
  const funnel = funnelCounts.map(([name, count]) => ({
    name,
    count,
    percent: uniqueLeads.size
      ? Math.round((count / uniqueLeads.size) * 100)
      : 0,
  }));
  const chartEnd = dateKey(new Date(Math.min(end.getTime(), now.getTime())));
  const chartStart = dateKey(
    new Date(
      Math.max(start.getTime(), dayStart(shiftDate(chartEnd, -59)).getTime()),
    ),
  );
  const chartMap = new Map<string, DailyPoint>();
  for (
    let cursor = chartStart;
    cursor <= chartEnd;
    cursor = shiftDate(cursor, 1)
  )
    chartMap.set(cursor, {
      date: cursor,
      label: `${cursor.slice(8)}/${cursor.slice(5, 7)}`,
      spend: null,
      revenue: mixedCurrencies ? null : 0,
      sales: 0,
      leads: 0,
      roas: null,
    });
  for (const sale of sales) {
    const point = chartMap.get(dateKey(new Date(sale.event_time)));
    if (point) {
      point.sales++;
      if (point.revenue !== null)
        point.revenue = roundMoney(point.revenue + finite(sale.value));
    }
  }
  for (const lead of uniqueLeads.values()) {
    const point = chartMap.get(dateKey(new Date(lead.first_seen_at)));
    if (point) point.leads++;
  }
  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  return {
    currency,
    filterPeriod: period,
    filterClient: filter.clientId || null,
    filterCampaignStatus: campaignStatus,
    filterCampaignIds: campaignIds,
    campaignOptions: [...options.values()].sort((a, b) =>
      a.name.localeCompare(b.name, "pt-BR"),
    ),
    campaignCatalogSyncedAt: catalogDates.sort()[0] || null,
    campaignCatalogWarnings: [...new Set(catalogWarnings)],
    periodLabel: PERIOD_LABELS[period] || "Período personalizado",
    rangeLabel: `${formatter.format(start)} — ${formatter.format(end)}`,
    generatedAt: now.toISOString(),
    attributionNote:
      "Receita por anúncio usa a origem salva no evento. Vendas sem origem permanecem no total, sem atribuição retroativa.",
    revenueByCurrency,
    unattributedPurchases: sales.length - attributedPurchases,
    dataQuality: {
      hasPeriodSpend: false,
      partial: !!snapshot.partial,
      excludedTestEvents: receivedEvents.length - productionEvents.length,
      duplicateAttempts: productionEvents.length - events.length,
      attributionCoverage: sales.length
        ? Math.round((attributedPurchases / sales.length) * 100)
        : 0,
      chartLimited: start.getTime() < dayStart(chartStart).getTime(),
    },
    kpis: {
      revenue,
      spend: null,
      profit: null,
      roas: null,
      roiPercent: null,
      purchases: sales.length,
      leads: uniqueLeads.size,
      averageTicket:
        revenue !== null && sales.length
          ? roundMoney(revenue / sales.length)
          : revenue === 0
            ? 0
            : null,
      costPerLead: null,
      cpa: null,
      conversionRate: uniqueLeads.size
        ? Math.round((cohortBuyers / uniqueLeads.size) * 1000) / 10
        : 0,
    },
    chart: [...chartMap.values()],
    campaigns: [...campaigns.values()]
      .filter(
        (row) =>
          matchesCampaignStatus(
            { effective_status: row.status },
            campaignStatus,
          ) &&
          (!selectedIds.size ||
            (!!row.campaign_id && selectedIds.has(row.campaign_id))),
      )
      .sort((a, b) => b.revenue - a.revenue),
    adsets: [...adsets.values()]
      .filter((row) => {
        const option = row.campaign_id
          ? options.get(`${row.client_id}:${row.campaign_id}`)
          : undefined;
        return (
          matchesCampaignStatus(option || {}, campaignStatus) &&
          (!selectedIds.size ||
            (!!row.campaign_id && selectedIds.has(row.campaign_id)))
        );
      })
      .sort((a, b) => b.revenue - a.revenue),
    ads: ads
      .filter((row) => {
        const option = row.campaign_id
          ? options.get(`${row.client_id}:${row.campaign_id}`)
          : undefined;
        return (
          matchesCampaignStatus(option || {}, campaignStatus) &&
          (!selectedIds.size ||
            (!!row.campaign_id && selectedIds.has(row.campaign_id)))
        );
      })
      .sort((a, b) => b.revenue - a.revenue),
    funnel,
    clients: snapshot.clients.map((client) => ({
      id: client.id,
      name: client.name,
    })),
  };
}

async function paged<T>(
  read: (offset: number, limit: number) => Promise<T[]>,
): Promise<{ rows: T[]; partial: boolean }> {
  const rows: T[] = [];
  const limit = 500;
  // Bound memory and make any application-side cap visible instead of silently truncating it.
  for (let offset = 0; offset < 100_000; offset += limit) {
    const page = await read(offset, limit);
    rows.push(...page);
    if (page.length < limit) return { rows, partial: false };
  }
  return { rows, partial: true };
}

export async function getDashboardData(
  filter: DashboardFilter = {},
): Promise<DashboardData> {
  const [clients, leads, events] = await Promise.all([
    listClients(),
    paged((offset, limit) =>
      listLeads({
        clientId: filter.clientId || null,
        filter: "todos",
        offset,
        limit,
      }),
    ),
    paged((offset, limit) => listEvents({ status: "enviado", offset, limit })),
  ]);
  const campaignCatalogs: DashboardCampaignCatalog[] = [];
  const indexedAds: { clientId: string; adId: string }[] = [];
  await Promise.all(
    clients
      .filter((client) => !filter.clientId || client.id === filter.clientId)
      .map(async (client) => {
        const [catalogRaw, indexRaw] = await Promise.all([
          getSetting(`meta_campaign_catalog_${client.id}`),
          getSetting(`meta_synced_ad_ids_${client.id}`),
        ]);
        if (catalogRaw) {
          try {
            const catalog = record(JSON.parse(catalogRaw));
            campaignCatalogs.push({
              clientId: client.id,
              accountId:
                typeof catalog.accountId === "string"
                  ? catalog.accountId
                  : undefined,
              campaigns: Array.isArray(catalog.campaigns)
                ? catalog.campaigns.flatMap((value) => {
                    const item = record(value);
                    return typeof item.id === "string" && /^\d+$/.test(item.id)
                      ? [
                          {
                            id: item.id,
                            name:
                              typeof item.name === "string"
                                ? item.name
                                : `Campanha ${item.id}`,
                            status:
                              typeof item.status === "string"
                                ? item.status
                                : null,
                            effective_status:
                              typeof item.effective_status === "string"
                                ? item.effective_status
                                : null,
                          },
                        ]
                      : [];
                  })
                : [],
              syncedAt:
                typeof catalog.syncedAt === "string"
                  ? catalog.syncedAt
                  : undefined,
              partial: catalog.partial === true,
              warnings: Array.isArray(catalog.warnings)
                ? catalog.warnings.filter(
                    (value): value is string => typeof value === "string",
                  )
                : [],
            });
          } catch {
            campaignCatalogs.push({
              clientId: client.id,
              campaigns: [],
              partial: true,
              warnings: [
                "Catálogo salvo inválido; carregue as campanhas novamente.",
              ],
            });
          }
        }
        if (indexRaw) {
          try {
            const index = record(JSON.parse(indexRaw));
            const expected = accountKey(client.ad_account_id);
            if (
              expected &&
              accountKey(
                typeof index.accountId === "string" ? index.accountId : null,
              ) !== expected
            )
              return;
            if (Array.isArray(index.adIds))
              for (const id of index.adIds)
                if (typeof id === "string" && /^\d+$/.test(id))
                  indexedAds.push({ clientId: client.id, adId: id });
          } catch {
            /* Invalid indexes never broaden the read to another account. */
          }
        }
      }),
  );
  const pairs = new Map<string, { clientId: string; adId: string }>();
  for (const pair of indexedAds)
    pairs.set(`${pair.clientId}:${pair.adId}`, pair);
  for (const lead of leads.rows)
    if (lead.source_id)
      pairs.set(`${lead.client_id}:${lead.source_id}`, {
        clientId: lead.client_id,
        adId: lead.source_id,
      });
  for (const event of events.rows) {
    const adId = savedAdId(event);
    if (adId)
      pairs.set(`${event.client_id}:${adId}`, {
        clientId: event.client_id,
        adId,
      });
  }
  const ads: AdInfo[] = [];
  const values = [...pairs.values()];
  for (let index = 0; index < values.length; index += 100)
    ads.push(...(await adsFor(values.slice(index, index + 100))).values());
  return buildDashboardData(
    {
      clients,
      leads: leads.rows,
      events: events.rows,
      ads,
      campaignCatalogs,
      partial: leads.partial || events.partial,
    },
    filter,
  );
}
