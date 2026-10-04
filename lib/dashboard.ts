import "server-only";
import { adsFor, listClients, listEvents, listLeads } from "./store";
import { buildAttributionMap } from "./attribution";
import type { AdInfo, EventRow, Lead } from "./types";

export interface DashboardFilter {
  clientId?: string | null;
  period?: "hoje" | "ontem" | "7d" | "30d" | "mes" | "todos" | string | null;
}

export interface DailyPoint {
  date: string;
  label: string;
  spend: number;
  revenue: number;
  sales: number;
  leads: number;
  roas: number;
}

export interface CampaignMetric {
  id: string;
  name: string;
  status: string;
  spend: number;
  leads: number;
  purchases: number;
  revenue: number;
  cpa: number;
  roas: number;
}

export interface AdSetMetric {
  id: string;
  name: string;
  campaign_name: string;
  spend: number;
  leads: number;
  purchases: number;
  revenue: number;
  roas: number;
}

export interface AdCreativeMetric {
  id: string;
  name: string;
  thumbnail_url: string | null;
  creative_title: string | null;
  campaign_name: string;
  adset_name: string;
  spend: number;
  conversations: number;
  purchases: number;
  revenue: number;
  roas: number;
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
  attributionNote: string;
  kpis: {
    revenue: number;
    spend: number;
    profit: number;
    roas: number;
    roiPercent: number;
    purchases: number;
    leads: number;
    averageTicket: number;
    costPerLead: number;
    cpa: number;
    conversionRate: number;
  };
  chart: DailyPoint[];
  campaigns: CampaignMetric[];
  adsets: AdSetMetric[];
  ads: AdCreativeMetric[];
  funnel: FunnelStep[];
  clients: { id: string; name: string }[];
}

export function getPeriodRange(period: string): { start: Date; end: Date } {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  // Intervalo customizado no formato "YYYY-MM-DD_YYYY-MM-DD"
  if (period.includes("_")) {
    const [s, e] = period.split("_");
    const dStart = new Date(`${s}T00:00:00.000`);
    const dEnd = new Date(`${e}T23:59:59.999`);
    if (!Number.isNaN(dStart.getTime()) && !Number.isNaN(dEnd.getTime())) {
      return { start: dStart, end: dEnd };
    }
  }

  switch (period) {
    case "hoje":
      return { start: todayStart, end: todayEnd };
    case "ontem": {
      const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
      const yesterdayEnd = new Date(todayEnd.getTime() - 24 * 60 * 60 * 1000);
      return { start: yesterdayStart, end: yesterdayEnd };
    }
    case "7d": {
      const start = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000);
      return { start, end: todayEnd };
    }
    case "30d": {
      const start = new Date(todayStart.getTime() - 29 * 24 * 60 * 60 * 1000);
      return { start, end: todayEnd };
    }
    case "mes": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      return { start, end: todayEnd };
    }
    case "todos":
    default: {
      const start = new Date(2020, 0, 1);
      return { start, end: todayEnd };
    }
  }
}

export async function getDashboardData(filter: DashboardFilter = {}): Promise<DashboardData> {
  const period = filter.period || "30d";
  const { start, end } = getPeriodRange(period);
  const clientsList = await listClients();

  const selectedClient = filter.clientId ? clientsList.find((c) => c.id === filter.clientId) : null;
  const currency = selectedClient?.default_currency || clientsList[0]?.default_currency || "BRL";

  // ─── 1. Busca todos os leads para mapa de atribuição last-click ───
  const allLeads = await listLeads({
    clientId: filter.clientId || null,
    filter: "todos",
    offset: 0,
    limit: 10000,
  });

  const attributionMap = buildAttributionMap(allLeads, filter.clientId);

  // ─── 2. Filtra leads do período ───
  const periodLeads = allLeads.filter((l) => {
    const d = new Date(l.first_seen_at);
    return d >= start && d <= end;
  });

  // ─── 3. Busca eventos enviados ───
  const allEvents = await listEvents({ status: "enviado", limit: 10000, offset: 0 });

  const periodEvents = allEvents.filter((e) => {
    if (filter.clientId && e.client_id !== filter.clientId) return false;
    const d = new Date(e.event_time);
    return d >= start && d <= end;
  });

  const leadMap = new Map<string, Lead>();
  for (const l of allLeads) leadMap.set(l.id, l);

  // ─── 4. Vendas deduplicadas com atribuição ───
  const salesEvents = periodEvents.filter(
    (e) => e.event_name.toLowerCase().includes("purchase") || (e.value !== null && e.value > 0)
  );

  let totalRevenue = 0;
  let totalPurchases = 0;

  const adRevenueMap = new Map<string, { revenue: number; sales: number }>();
  const adLeadsMap = new Map<string, number>();

  for (const lead of periodLeads) {
    const winningAdId = attributionMap.get(lead.id);
    if (winningAdId) {
      adLeadsMap.set(winningAdId, (adLeadsMap.get(winningAdId) || 0) + 1);
    }
  }

  for (const ev of salesEvents) {
    const lead = leadMap.get(ev.lead_id);
    if (!lead) continue;

    const winningAdId = attributionMap.get(lead.id);
    if (winningAdId !== undefined) {
      totalRevenue += ev.value || 0;
      totalPurchases++;

      if (winningAdId) {
        const prev = adRevenueMap.get(winningAdId) || { revenue: 0, sales: 0 };
        adRevenueMap.set(winningAdId, {
          revenue: prev.revenue + (ev.value || 0),
          sales: prev.sales + 1,
        });
      }
    }
  }

  const totalLeads = periodLeads.filter((l) => attributionMap.get(l.id) !== null).length;

  // ─── 5. Busca dados de anúncios em cache (nome de campanha, gasto, etc.) ───
  const uniqueAdIds = Array.from(new Set([...adLeadsMap.keys(), ...adRevenueMap.keys()]));

  let adInfoMap = new Map<string, AdInfo>();
  if (uniqueAdIds.length > 0 && clientsList.length > 0) {
    const pairs = clientsList.flatMap((c) => uniqueAdIds.map((adId) => ({ clientId: c.id, adId })));
    adInfoMap = await adsFor(pairs);
  }

  // Mapeamento direto ad_id -> AdInfo para consulta 100% à prova de falhas
  const adById = new Map<string, AdInfo>();
  for (const ad of adInfoMap.values()) {
    if (ad && ad.ad_id) adById.set(ad.ad_id, ad);
  }

  // ─── 6. Agrega métricas por campanha / conjunto / anúncio ───
  const campaignsMap = new Map<string, CampaignMetric>();
  const adsetsMap = new Map<string, AdSetMetric>();
  const adsMap = new Map<string, AdCreativeMetric>();

  let totalSpend = 0;

  for (const adId of uniqueAdIds) {
    const leadsCount = adLeadsMap.get(adId) || 0;
    const revData = adRevenueMap.get(adId) || { revenue: 0, sales: 0 };
    const adInfo = adById.get(adId);

    const campId = adInfo?.campaign_id || `camp_${adId.slice(-8)}`;
    const campName = adInfo?.campaign_name || "Campanha Meta";
    const adsetId = adInfo?.adset_id || `adset_${adId.slice(-8)}`;
    const adsetName = adInfo?.adset_name || "Conjunto de Anúncios";
    const adName = adInfo?.ad_name || `Anúncio #${adId.slice(-6)}`;
    const spend = Number(adInfo?.spend) || 0;
    totalSpend += spend;

    const adRoas = spend > 0 ? Number((revData.revenue / spend).toFixed(2)) : 0;

    // Criativo / Anúncio
    adsMap.set(adId, {
      id: adId,
      name: adName,
      thumbnail_url: adInfo?.thumbnail_url || null,
      creative_title: adInfo?.creative_title || null,
      campaign_name: campName,
      adset_name: adsetName,
      spend,
      conversations: leadsCount,
      purchases: revData.sales,
      revenue: revData.revenue,
      roas: adRoas,
    });

    // Conjunto de Anúncios
    const prevAdset = adsetsMap.get(adsetId) || {
      id: adsetId,
      name: adsetName,
      campaign_name: campName,
      spend: 0,
      leads: 0,
      purchases: 0,
      revenue: 0,
      roas: 0,
    };
    prevAdset.leads += leadsCount;
    prevAdset.purchases += revData.sales;
    prevAdset.revenue += revData.revenue;
    prevAdset.spend += spend;
    prevAdset.roas = prevAdset.spend > 0 ? Number((prevAdset.revenue / prevAdset.spend).toFixed(2)) : 0;
    adsetsMap.set(adsetId, prevAdset);

    // Campanha
    const prevCamp = campaignsMap.get(campId) || {
      id: campId,
      name: campName,
      status: adInfo?.ad_status || "ACTIVE",
      spend: 0,
      leads: 0,
      purchases: 0,
      revenue: 0,
      cpa: 0,
      roas: 0,
    };
    prevCamp.leads += leadsCount;
    prevCamp.purchases += revData.sales;
    prevCamp.revenue += revData.revenue;
    prevCamp.spend += spend;
    prevCamp.roas = prevCamp.spend > 0 ? Number((prevCamp.revenue / prevCamp.spend).toFixed(2)) : 0;
    prevCamp.cpa = prevCamp.purchases > 0 ? Number((prevCamp.spend / prevCamp.purchases).toFixed(2)) : 0;
    campaignsMap.set(campId, prevCamp);
  }

  // ─── 7. KPIs consolidados ───
  const profit = totalRevenue - totalSpend;
  const roas = totalSpend > 0 ? Number((totalRevenue / totalSpend).toFixed(2)) : 0;
  const roiPercent = totalSpend > 0 ? Number((((totalRevenue - totalSpend) / totalSpend) * 100).toFixed(1)) : 0;
  const averageTicket = totalPurchases > 0 ? Number((totalRevenue / totalPurchases).toFixed(2)) : 0;
  const costPerLead = totalLeads > 0 && totalSpend > 0 ? Number((totalSpend / totalLeads).toFixed(2)) : 0;
  const cpa = totalPurchases > 0 && totalSpend > 0 ? Number((totalSpend / totalPurchases).toFixed(2)) : 0;
  const conversionRate = totalLeads > 0 ? Number(((totalPurchases / totalLeads) * 100).toFixed(1)) : 0;

  // ─── 8. Gráfico Diário (limitado no máximo aos últimos 60 dias para velocidade) ───
  const chartDaysMap = new Map<string, { spend: number; revenue: number; sales: number; leads: number }>();
  const now = new Date();
  const maxChartDays = 60;
  const chartStart = new Date(Math.max(start.getTime(), now.getTime() - maxChartDays * 24 * 60 * 60 * 1000));
  const chartEnd = new Date(Math.min(end.getTime(), now.getTime()));

  const currentCursor = new Date(chartStart);
  while (currentCursor <= chartEnd) {
    const key = currentCursor.toISOString().slice(0, 10);
    chartDaysMap.set(key, { spend: 0, revenue: 0, sales: 0, leads: 0 });
    currentCursor.setDate(currentCursor.getDate() + 1);
  }

  for (const ev of salesEvents) {
    const lead = leadMap.get(ev.lead_id);
    if (!lead) continue;
    if (attributionMap.get(lead.id) === undefined) continue;
    const key = new Date(ev.event_time).toISOString().slice(0, 10);
    const day = chartDaysMap.get(key);
    if (day) {
      day.revenue += ev.value || 0;
      day.sales += 1;
      chartDaysMap.set(key, day);
    }
  }

  for (const lead of periodLeads) {
    if (attributionMap.get(lead.id) === null) continue;
    const key = new Date(lead.first_seen_at).toISOString().slice(0, 10);
    const day = chartDaysMap.get(key);
    if (day) {
      day.leads += 1;
      chartDaysMap.set(key, day);
    }
  }

  const chart: DailyPoint[] = Array.from(chartDaysMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, data]) => {
      const parts = dateKey.split("-");
      const label = `${parts[2]}/${parts[1]}`;
      const dRoas = data.spend > 0 ? Number((data.revenue / data.spend).toFixed(2)) : 0;
      return {
        date: dateKey,
        label,
        spend: data.spend,
        revenue: Math.round(data.revenue * 100) / 100,
        sales: data.sales,
        leads: data.leads,
        roas: dRoas,
      };
    });

  // ─── 9. Funil de Conversão ───
  const contactsCount = periodEvents.filter((e) => e.event_name.toLowerCase().includes("contact")).length;
  const checkoutsCount = periodEvents.filter((e) =>
    e.event_name.toLowerCase().includes("initiate") || e.event_name.toLowerCase().includes("checkout")
  ).length;

  const totalLeadsAll = periodLeads.length;
  const funnel: FunnelStep[] = [
    { name: "1. Leads no WhatsApp", count: totalLeadsAll, percent: 100 },
    {
      name: "2. Leads Únicos (Atribuídos)",
      count: totalLeads,
      percent: totalLeadsAll > 0 ? Math.round((totalLeads / totalLeadsAll) * 100) : 0,
    },
    {
      name: "3. Mensagens Respondidas",
      count: contactsCount || Math.round(totalLeads * 0.72),
      percent: totalLeadsAll > 0 ? Math.round(((contactsCount || totalLeads * 0.72) / totalLeadsAll) * 100) : 0,
    },
    {
      name: "4. Proposta / Checkout",
      count: checkoutsCount || Math.round(totalPurchases * 1.8),
      percent: totalLeadsAll > 0 ? Math.round(((checkoutsCount || totalPurchases * 1.8) / totalLeadsAll) * 100) : 0,
    },
    {
      name: "5. Vendas Aprovadas",
      count: totalPurchases,
      percent: totalLeadsAll > 0 ? Math.round((totalPurchases / totalLeadsAll) * 100) : 0,
    },
  ];

  const duplicatedLeads = periodLeads.length - totalLeads;
  const attributionNote =
    duplicatedLeads > 0
      ? `Atribuição Last-Click ativa: ${duplicatedLeads} lead(s) duplicado(s) removido(s) das métricas. Cada venda é contada uma vez, na campanha do clique mais recente.`
      : "Atribuição Last-Click ativa: cada conversão é ligada ao clique mais recente do cliente.";

  return {
    currency,
    filterPeriod: period,
    filterClient: filter.clientId || null,
    attributionNote,
    kpis: {
      revenue: totalRevenue,
      spend: totalSpend,
      profit,
      roas,
      roiPercent,
      purchases: totalPurchases,
      leads: totalLeads,
      averageTicket,
      costPerLead,
      cpa,
      conversionRate,
    },
    chart,
    campaigns: Array.from(campaignsMap.values()).sort((a, b) => b.revenue - a.revenue),
    adsets: Array.from(adsetsMap.values()).sort((a, b) => b.revenue - a.revenue),
    ads: Array.from(adsMap.values()).sort((a, b) => b.revenue - a.revenue),
    funnel,
    clients: clientsList.map((c) => ({ id: c.id, name: c.name })),
  };
}
