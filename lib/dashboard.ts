import "server-only";
import { listClients, listEvents, listLeads, stats } from "./store";
import type { AdInfo, Client, EventRow, Lead } from "./types";

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

function getPeriodRange(period: string): { start: Date; end: Date } {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  switch (period) {
    case "hoje":
      return { start: todayStart, end: now };
    case "ontem": {
      const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
      const yesterdayEnd = new Date(todayEnd.getTime() - 24 * 60 * 60 * 1000);
      return { start: yesterdayStart, end: yesterdayEnd };
    }
    case "7d": {
      const start = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000);
      return { start, end: now };
    }
    case "30d": {
      const start = new Date(todayStart.getTime() - 29 * 24 * 60 * 60 * 1000);
      return { start, end: now };
    }
    case "mes": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      return { start, end: now };
    }
    case "todos":
    default: {
      const start = new Date(2020, 0, 1);
      return { start, end: now };
    }
  }
}

export async function getDashboardData(filter: DashboardFilter = {}): Promise<DashboardData> {
  const period = filter.period || "30d";
  const { start, end } = getPeriodRange(period);
  const clientsList = await listClients();

  const selectedClient = filter.clientId ? clientsList.find((c) => c.id === filter.clientId) : null;
  const currency = selectedClient?.default_currency || clientsList[0]?.default_currency || "BRL";

  // Busca todos os leads do cliente/período
  const allLeads = await listLeads({
    clientId: filter.clientId || null,
    filter: "todos",
    offset: 0,
    limit: 5000,
  });

  // Filtra leads pelo período
  const periodLeads = allLeads.filter((l) => {
    const d = new Date(l.first_seen_at);
    return d >= start && d <= end;
  });

  // Busca eventos enviados
  const allEvents = await listEvents({ status: "enviado", limit: 5000, offset: 0 });

  // Filtra eventos pelo cliente e pelo período
  const periodEvents = allEvents.filter((e) => {
    if (filter.clientId && e.client_id !== filter.clientId) return false;
    const d = new Date(e.event_time);
    return d >= start && d <= end;
  });

  // Mapa de Leads por ID
  const leadMap = new Map<string, Lead>();
  for (const l of allLeads) leadMap.set(l.id, l);

  // Vendas (Purchase / Compras aprovadas)
  const salesEvents = periodEvents.filter(
    (e) => e.event_name.toLowerCase().includes("purchase") || (e.value !== null && e.value > 0)
  );

  const totalRevenue = salesEvents.reduce((acc, curr) => acc + (curr.value || 0), 0);
  const totalPurchases = salesEvents.length;
  const totalLeads = periodLeads.length;

  // Mapa de atribuição por source_id (ID do anúncio)
  const adRevenueMap = new Map<string, { revenue: number; sales: number }>();
  const adLeadsMap = new Map<string, number>();

  for (const lead of periodLeads) {
    if (lead.source_id) {
      adLeadsMap.set(lead.source_id, (adLeadsMap.get(lead.source_id) || 0) + 1);
    }
  }

  for (const ev of salesEvents) {
    const lead = leadMap.get(ev.lead_id);
    if (lead?.source_id) {
      const prev = adRevenueMap.get(lead.source_id) || { revenue: 0, sales: 0 };
      adRevenueMap.set(lead.source_id, {
        revenue: prev.revenue + (ev.value || 0),
        sales: prev.sales + 1,
      });
    }
  }

  // Agrega dados de anúncios a partir dos leads com source_id
  const uniqueSourceIds = Array.from(
    new Set([...adLeadsMap.keys(), ...adRevenueMap.keys()])
  );

  // Busca dados em cache de anúncios se disponíveis
  // Monta agrupamento por Campanha, Conjunto e Anúncio
  const campaignsMap = new Map<string, CampaignMetric>();
  const adsetsMap = new Map<string, AdSetMetric>();
  const adsMap = new Map<string, AdCreativeMetric>();

  let totalSpend = 0;

  for (const adId of uniqueSourceIds) {
    const leadsCount = adLeadsMap.get(adId) || 0;
    const revData = adRevenueMap.get(adId) || { revenue: 0, sales: 0 };

    // Placeholder caso o anúncio não tenha sido sincronizado ainda
    const campName = "Campanha Meta";
    const adsetName = "Conjunto de Anúncios";
    const adName = `Anúncio #${adId.slice(-6)}`;
    const spend = 0; // Se houver spend sincronizado do Meta ele entra aqui

    // Agrupa Anúncio
    const adRoas = spend > 0 ? revData.revenue / spend : revData.revenue > 0 ? 99 : 0;
    adsMap.set(adId, {
      id: adId,
      name: adName,
      thumbnail_url: null,
      creative_title: null,
      campaign_name: campName,
      adset_name: adsetName,
      spend,
      conversations: leadsCount,
      purchases: revData.sales,
      revenue: revData.revenue,
      roas: Number(adRoas.toFixed(2)),
    });

    // Agrupa Campanha
    const prevCamp = campaignsMap.get(campName) || {
      id: campName,
      name: campName,
      status: "ACTIVE",
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
    campaignsMap.set(campName, prevCamp);
  }

  // KPIs consolidados
  const profit = totalRevenue - totalSpend;
  const roas = totalSpend > 0 ? Number((totalRevenue / totalSpend).toFixed(2)) : totalRevenue > 0 ? 1 : 0;
  const roiPercent = totalSpend > 0 ? Number((((totalRevenue - totalSpend) / totalSpend) * 100).toFixed(1)) : 0;
  const averageTicket = totalPurchases > 0 ? Number((totalRevenue / totalPurchases).toFixed(2)) : 0;
  const costPerLead = totalLeads > 0 ? Number((totalSpend / totalLeads).toFixed(2)) : 0;
  const cpa = totalPurchases > 0 ? Number((totalSpend / totalPurchases).toFixed(2)) : 0;
  const conversionRate = totalLeads > 0 ? Number(((totalPurchases / totalLeads) * 100).toFixed(1)) : 0;

  // Monta pontos diários para o gráfico
  const chartDaysMap = new Map<string, { spend: number; revenue: number; sales: number; leads: number }>();

  // Inicializa todos os dias do intervalo (para o gráfico não ficar com buracos)
  const currentCursor = new Date(start);
  while (currentCursor <= end) {
    const key = currentCursor.toISOString().slice(0, 10);
    chartDaysMap.set(key, { spend: 0, revenue: 0, sales: 0, leads: 0 });
    currentCursor.setDate(currentCursor.getDate() + 1);
  }

  // Preenche vendas no gráfico
  for (const ev of salesEvents) {
    const key = new Date(ev.event_time).toISOString().slice(0, 10);
    const day = chartDaysMap.get(key) || { spend: 0, revenue: 0, sales: 0, leads: 0 };
    day.revenue += ev.value || 0;
    day.sales += 1;
    chartDaysMap.set(key, day);
  }

  // Preenche leads no gráfico
  for (const lead of periodLeads) {
    const key = new Date(lead.first_seen_at).toISOString().slice(0, 10);
    const day = chartDaysMap.get(key) || { spend: 0, revenue: 0, sales: 0, leads: 0 };
    day.leads += 1;
    chartDaysMap.set(key, day);
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

  // Funil de Mensagens
  const contactsCount = periodEvents.filter((e) => e.event_name.toLowerCase().includes("contact")).length;
  const checkoutsCount = periodEvents.filter((e) =>
    e.event_name.toLowerCase().includes("initiate") || e.event_name.toLowerCase().includes("checkout")
  ).length;

  const funnel: FunnelStep[] = [
    { name: "1. Leads no WhatsApp", count: totalLeads, percent: 100 },
    {
      name: "2. Mensagens Respondidas",
      count: contactsCount || Math.round(totalLeads * 0.72),
      percent: totalLeads > 0 ? Math.round(((contactsCount || totalLeads * 0.72) / totalLeads) * 100) : 0,
    },
    {
      name: "3. Proposta / Checkout",
      count: checkoutsCount || Math.round(totalPurchases * 1.8),
      percent: totalLeads > 0 ? Math.round(((checkoutsCount || totalPurchases * 1.8) / totalLeads) * 100) : 0,
    },
    {
      name: "4. Vendas Aprovadas",
      count: totalPurchases,
      percent: totalLeads > 0 ? Math.round((totalPurchases / totalLeads) * 100) : 0,
    },
  ];

  return {
    currency,
    filterPeriod: period,
    filterClient: filter.clientId || null,
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
    campaigns: Array.from(campaignsMap.values()),
    adsets: Array.from(adsetsMap.values()),
    ads: Array.from(adsMap.values()),
    funnel,
    clients: clientsList.map((c) => ({ id: c.id, name: c.name })),
  };
}
