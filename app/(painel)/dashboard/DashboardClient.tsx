"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Copy,
  DollarSign,
  ExternalLink,
  Filter,
  Info,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  Printer,
  RefreshCw,
  Search,
  ShoppingBag,
  Target,
  TrendingUp,
  X,
} from "lucide-react";
import {
  loadDashboardCampaignsAction,
  syncDashboardMetaAction,
} from "@/app/actions";
import type { DashboardData } from "@/lib/dashboard";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import styles from "./Dashboard.module.css";

type View = "campanhas" | "conjuntos" | "anuncios";
type ChartMode = "receita" | "conversas" | "vendas";
type SortKey = "revenue" | "leads" | "purchases";
interface TableRow {
  id: string;
  name: string;
  detail: string;
  client: string;
  currency: string;
  status?: string;
  image?: string | null;
  leads: number;
  purchases: number;
  revenue: number;
}
const PERIODS = [
  { value: "hoje", label: "Hoje" },
  { value: "ontem", label: "Ontem" },
  { value: "7d", label: "Últimos 7 dias" },
  { value: "30d", label: "Últimos 30 dias" },
  { value: "mes", label: "Este mês" },
  { value: "todos", label: "Todo o histórico" },
];
const TABS: { id: View; label: string }[] = [
  { id: "campanhas", label: "Campanhas" },
  { id: "conjuntos", label: "Conjuntos" },
  { id: "anuncios", label: "Anúncios" },
];
const normal = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const ratio = (value: number, total: number) =>
  total > 0 ? `${Math.round((value / total) * 100)}%` : "0%";

/** Spreadsheet cells from contact/campaign names must not become executable formulas. */
function csvCell(value: string | number | null): string {
  let text = value === null ? "Indisponível" : String(value);
  if (typeof value === "string" && /^[\s]*[=+\-@]/.test(text))
    text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function Sparkline({
  values,
  color = "#7b39fc",
}: {
  values: number[];
  color?: string;
}) {
  const max = Math.max(...values, 1);
  const points = values
    .map(
      (value, index) =>
        `${(index / Math.max(values.length - 1, 1)) * 100},${28 - (value / max) * 24}`,
    )
    .join(" ");
  return (
    <svg viewBox="0 0 100 32" className={styles.sparkline} aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DashboardClient({ data }: { data: DashboardData }) {
  const [currentData, setCurrentData] = useState(data);
  const [clientId, setClientId] = useState(data.filterClient || "");
  const [period, setPeriod] = useState(data.filterPeriod);
  const [campaignStatus, setCampaignStatus] = useState(
    data.filterCampaignStatus,
  );
  const [campaignIds, setCampaignIds] = useState(data.filterCampaignIds);
  const [campaignSearch, setCampaignSearch] = useState("");
  const [isLoadingCampaigns, setIsLoadingCampaigns] = useState(false);
  const [activeTab, setActiveTab] = useState<View>("campanhas");
  const [chartMode, setChartMode] = useState<ChartMode>("receita");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDescending, setSortDescending] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [stale, setStale] = useState(false);
  const [showDates, setShowDates] = useState(false);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [showQuality, setShowQuality] = useState(false);
  const [hoveredPoint, setHoveredPoint] = useState<number | null>(null);
  const initial = useRef(true);

  useEffect(() => {
    setCurrentData(data);
    setClientId(data.filterClient || "");
    setPeriod(data.filterPeriod);
    setCampaignStatus(data.filterCampaignStatus);
    setCampaignIds(data.filterCampaignIds);
    setStale(false);
  }, [data]);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let controller: AbortController | null = null;
    const load = async () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      controller = new AbortController();
      setIsRefreshing(true);
      try {
        const params = new URLSearchParams({ periodo: period });
        if (clientId) params.set("cliente", clientId);
        params.set("status_campanha", campaignStatus);
        if (campaignIds.length) params.set("campanhas", campaignIds.join(","));
        const response = await fetch(`/api/dashboard/live?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403)
          throw new Error(
            "Sua sessão expirou. Entre novamente para atualizar o painel.",
          );
        if (!response.ok)
          throw new Error(
            "Não foi possível atualizar os resultados. Tente novamente.",
          );
        const result = (await response.json()) as {
          ok?: boolean;
          data?: DashboardData;
          error?: string;
        };
        if (!result.ok || !result.data)
          throw new Error(
            result.error ||
              "A atualização não retornou os resultados esperados.",
          );
        if (active) {
          setCurrentData(result.data);
          setStale(false);
          window.history.replaceState(null, "", `/dashboard?${params}`);
        }
      } catch (error) {
        if (
          active &&
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          setStale(true);
          setNotice({
            kind: "error",
            text:
              error instanceof Error ? error.message : "Falha na atualização.",
          });
        }
      } finally {
        inFlight = false;
        if (active) setIsRefreshing(false);
      }
    };
    if (initial.current) initial.current = false;
    else void load();
    const timer = autoRefresh
      ? window.setInterval(() => {
          void load();
        }, 30_000)
      : null;
    const onVisible = () => {
      if (!document.hidden && autoRefresh) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      controller?.abort();
      if (timer !== null) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [clientId, period, campaignStatus, campaignIds, refreshTick, autoRefresh]);

  const { kpis, currency, chart, funnel, dataQuality } = currentData;
  const multiCurrency = currentData.revenueByCurrency.length > 1;
  const effectiveChartMode =
    chartMode === "receita" && multiCurrency ? "vendas" : chartMode;
  const points = useMemo(
    () =>
      chart.map((point) =>
        effectiveChartMode === "receita"
          ? point.revenue || 0
          : effectiveChartMode === "vendas"
            ? point.sales
            : point.leads,
      ),
    [chart, effectiveChartMode],
  );
  const chartMax = Math.max(...points, 1);
  const plot = points.map((value, index) => ({
    x: 12 + (index / Math.max(points.length - 1, 1)) * 976,
    y: 204 - (value / chartMax) * 166,
  }));
  const line = plot.map(({ x, y }) => `${x},${y}`).join(" ");
  const area = plot.length ? `12,214 ${line} ${plot.at(-1)!.x},214` : "";
  const chartTotal = points.reduce((sum, value) => sum + value, 0);
  const hover = hoveredPoint !== null ? chart[hoveredPoint] : null;
  const clientName =
    currentData.clients.find((client) => client.id === currentData.filterClient)
      ?.name || "Todos os clientes";
  const dateOptionExists = PERIODS.some((option) => option.value === period);
  const rowData = useMemo<TableRow[]>(() => {
    if (activeTab === "campanhas")
      return currentData.campaigns.map((row) => ({
        ...row,
        detail: row.client_name,
        client: row.client_name,
      }));
    if (activeTab === "conjuntos")
      return currentData.adsets.map((row) => ({
        ...row,
        detail: row.campaign_name,
        client: row.client_name,
      }));
    return currentData.ads.map((row) => ({
      ...row,
      leads: row.conversations,
      detail: row.campaign_name,
      client: row.client_name,
      image: row.thumbnail_url,
    }));
  }, [activeTab, currentData]);
  const filteredRows = useMemo(() => {
    const search = normal(query.trim());
    return rowData
      .filter(
        (row) =>
          !search ||
          normal(`${row.name} ${row.detail} ${row.client}`).includes(search),
      )
      .sort((a, b) => (sortDescending ? -1 : 1) * (a[sortKey] - b[sortKey]));
  }, [rowData, query, sortKey, sortDescending]);
  const maxPage = Math.max(1, Math.ceil(filteredRows.length / 6));
  const currentPage = Math.min(page, maxPage);
  const visibleRows = filteredRows.slice(
    (currentPage - 1) * 6,
    currentPage * 6,
  );
  const hasData = kpis.leads > 0 || kpis.purchases > 0;
  const filtered = !!clientId || period !== "30d";
  const availableCampaigns = currentData.campaignOptions.filter((campaign) => {
    const status = campaign.effective_status || campaign.status;
    return (
      (!clientId || campaign.clientId === clientId) &&
      (campaignStatus === "all" ||
        status === (campaignStatus === "active" ? "ACTIVE" : "PAUSED")) &&
      (!campaignSearch.trim() ||
        normal(
          `${campaign.name} ${campaign.clientName} ${campaign.id}`,
        ).includes(normal(campaignSearch.trim())))
    );
  });

  async function handleSync() {
    if (isSyncing || isLoadingCampaigns) return;
    setIsSyncing(true);
    setNotice(null);
    try {
      const result = await syncDashboardMetaAction(clientId || null, {
        campaignStatus,
        campaignIds,
      });
      setNotice({
        kind: result.ok ? "success" : "error",
        text: result.message,
      });
      setRefreshTick((tick) => tick + 1);
    } catch {
      setNotice({
        kind: "error",
        text: "A sincronização não foi concluída. Confira a conexão e tente novamente.",
      });
    } finally {
      setIsSyncing(false);
    }
  }

  async function handleLoadCampaigns() {
    if (isLoadingCampaigns || isSyncing) return;
    setIsLoadingCampaigns(true);
    setNotice(null);
    try {
      const result = await loadDashboardCampaignsAction(clientId || null);
      setNotice({
        kind: result.ok ? "success" : "error",
        text: result.message,
      });
      setRefreshTick((tick) => tick + 1);
    } catch {
      setNotice({
        kind: "error",
        text: "Não foi possível carregar as campanhas. Confira a conta de anúncios e o token de leitura.",
      });
    } finally {
      setIsLoadingCampaigns(false);
    }
  }

  async function handleCopy() {
    const revenueText = multiCurrency
      ? currentData.revenueByCurrency
          .map((row) => formatMoney(row.value, row.currency))
          .join(" + ")
      : formatMoney(kpis.revenue, currency);
    const text = `Track Manual · Relatório de desempenho\n${clientName} · ${currentData.periodLabel}\n${currentData.rangeLabel}\n\nReceita registrada: ${revenueText}\nCompras em produção: ${kpis.purchases}\nNovos contatos: ${kpis.leads}\nTicket médio: ${formatMoney(kpis.averageTicket, currency)}\nConversão dos novos contatos: ${kpis.conversionRate}%\nROAS: indisponível — investimento diário ainda não informado.\n\nTestes e tentativas repetidas não entram na receita.`;
    try {
      await navigator.clipboard.writeText(text);
      setNotice({
        kind: "success",
        text: "Relatório copiado. Pronto para compartilhar.",
      });
    } catch {
      setNotice({
        kind: "error",
        text: "Não foi possível copiar. Use a exportação CSV ou a impressão.",
      });
    }
  }

  function handleExport() {
    const rows: (string | number | null)[][] = [
      ["Track Manual — Relatório de desempenho"],
      ["Cliente", clientName],
      ["Período", currentData.periodLabel],
      ["Intervalo", currentData.rangeLabel],
      ["Gerado em", formatDateTime(currentData.generatedAt)],
      [],
      ["Moeda", "Receita registrada"],
      ...currentData.revenueByCurrency.map((row) => [row.currency, row.value]),
      [],
      ["Novos contatos", kpis.leads],
      ["Compras em produção", kpis.purchases],
      ["ROAS", "Indisponível: investimento diário pendente"],
      ["Filtro da tabela de campanhas", currentData.filterCampaignStatus],
      [
        "IDs selecionados",
        currentData.filterCampaignIds.join(", ") || "Todas do status",
      ],
      [
        "Escopo dos indicadores gerais",
        "Todos os contatos e compras do cliente e período",
      ],
      [],
      [
        "Campanha",
        "Cliente",
        "Moeda",
        "Contatos",
        "Compras",
        "Receita",
        "ROAS",
      ],
      ...currentData.campaigns.map((row) => [
        row.name,
        row.client_name,
        row.currency,
        row.leads,
        row.purchases,
        row.revenue,
        null,
      ]),
    ];
    const blob = new Blob(
      ["\uFEFF" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `track-manual-relatorio-${currentData.generatedAt.slice(0, 10)}.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function applyCustomDates() {
    if (!customStart || !customEnd || customStart > customEnd) {
      setNotice({
        kind: "error",
        text: "Escolha uma data inicial e uma data final válidas.",
      });
      return;
    }
    setPeriod(`${customStart}_${customEnd}`);
    setShowDates(false);
  }

  function changeSort(key: SortKey) {
    if (key === sortKey) setSortDescending((value) => !value);
    else {
      setSortKey(key);
      setSortDescending(true);
    }
    setPage(1);
  }
  function chartValue(value: number) {
    return effectiveChartMode === "receita"
      ? formatMoney(value, currency)
      : formatNumber(value);
  }

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>PAINEL DE RESULTADOS</span>
          <h1>
            Visão geral<span className={styles.headingDot}>.</span>
          </h1>
          <p>Seu atendimento, suas conversões e o próximo passo.</p>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={handleExport}
          >
            <ArrowDownToLine size={16} /> Exportar relatório
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => {
              void handleSync();
            }}
            disabled={isSyncing || isLoadingCampaigns}
          >
            <RefreshCw size={16} className={isSyncing ? styles.spin : ""} />
            {isSyncing ? "Sincronizando…" : "Sincronizar Meta"}
          </button>
        </div>
      </div>

      <div className={styles.filterBar}>
        <div className={styles.filters}>
          <label className={styles.filterControl}>
            <CalendarDays size={16} />
            <select
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
              aria-label="Período dos resultados"
            >
              {PERIODS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              {!dateOptionExists && (
                <option value={period}>Período personalizado</option>
              )}
            </select>
            <ChevronDown size={13} />
          </label>
          <label className={styles.filterControl}>
            <span className={styles.clientDot} />
            <select
              value={clientId}
              onChange={(event) => {
                setClientId(event.target.value);
                setCampaignIds([]);
              }}
              aria-label="Filtrar por cliente"
            >
              <option value="">Todos os clientes</option>
              {currentData.clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
            <ChevronDown size={13} />
          </label>
          <button
            type="button"
            className={`${styles.filterButton} ${showDates ? styles.filterSelected : ""}`}
            onClick={() => setShowDates((value) => !value)}
            aria-expanded={showDates}
          >
            <Filter size={15} /> Personalizar
          </button>
          {filtered && (
            <button
              type="button"
              className={styles.resetButton}
              onClick={() => {
                setClientId("");
                setPeriod("30d");
              }}
            >
              <X size={13} /> Limpar
            </button>
          )}
        </div>
        <button
          type="button"
          className={styles.liveButton}
          onClick={() => setAutoRefresh((value) => !value)}
          aria-pressed={autoRefresh}
          title="Ativar ou pausar atualização automática"
        >
          <span
            className={
              stale
                ? styles.staleDot
                : autoRefresh
                  ? styles.liveDot
                  : styles.pausedDot
            }
          />
          {isRefreshing
            ? "Atualizando…"
            : stale
              ? "Atualização pendente"
              : autoRefresh
                ? "Atualização automática"
                : "Atualização pausada"}
        </button>
      </div>

      {showDates && (
        <div className={styles.datePanel}>
          <label>
            De
            <input
              type="date"
              value={customStart}
              onChange={(event) => setCustomStart(event.target.value)}
            />
          </label>
          <label>
            Até
            <input
              type="date"
              value={customEnd}
              min={customStart}
              onChange={(event) => setCustomEnd(event.target.value)}
            />
          </label>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={applyCustomDates}
          >
            Aplicar período
            <ArrowRight size={15} />
          </button>
        </div>
      )}
      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={`${styles.notice} ${notice.kind === "error" ? styles.errorNotice : styles.successNotice}`}
        >
          {notice.kind === "error" ? (
            <Info size={17} />
          ) : (
            <CheckCircle2 size={17} />
          )}
          <span>{notice.text}</span>
          <button
            type="button"
            aria-label="Fechar aviso"
            onClick={() => setNotice(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {dataQuality.partial && (
        <div className={`${styles.notice} ${styles.errorNotice}`} role="alert">
          <Info size={17} />
          <span>
            Esta consulta atingiu o limite de registros. Os resultados são
            parciais; selecione um cliente para reduzir o volume.
          </span>
        </div>
      )}

      <section
        className={styles.metrics}
        aria-label="Indicadores principais"
        aria-busy={isRefreshing}
      >
        <article className={`${styles.metricCard} ${styles.featuredMetric}`}>
          <div className={styles.metricTop}>
            <span>Receita registrada</span>
            <span className={styles.metricIcon}>
              <DollarSign size={18} />
            </span>
          </div>
          <strong className={styles.metricValue}>
            {multiCurrency
              ? "Multi-moeda"
              : formatMoney(kpis.revenue, currency)}
          </strong>
          <div className={styles.metricFoot}>
            <span className={styles.purpleTag}>Produção</span>
            <span>
              {multiCurrency
                ? `${currentData.revenueByCurrency.length} moedas, sem somar valores`
                : "Compras do período selecionado"}
            </span>
          </div>
          <Sparkline values={chart.map((point) => point.revenue || 0)} />
        </article>
        <article className={styles.metricCard}>
          <div className={styles.metricTop}>
            <span>Vendas registradas</span>
            <span className={`${styles.metricIcon} ${styles.greenIcon}`}>
              <ShoppingBag size={18} />
            </span>
          </div>
          <strong className={styles.metricValue}>
            {formatNumber(kpis.purchases)}
          </strong>
          <div className={styles.metricFoot}>
            <span className={styles.greenTag}>
              <Check size={11} /> Eventos únicos
            </span>
            <span>Sem testes ou tentativas repetidas</span>
          </div>
          <Sparkline
            values={chart.map((point) => point.sales)}
            color="#19a777"
          />
        </article>
        <article className={styles.metricCard}>
          <div className={styles.metricTop}>
            <span>Novos contatos</span>
            <span className={`${styles.metricIcon} ${styles.blueIcon}`}>
              <MessageCircle size={18} />
            </span>
          </div>
          <strong className={styles.metricValue}>
            {formatNumber(kpis.leads)}
          </strong>
          <div className={styles.metricFoot}>
            <span className={styles.blueTag}>
              {kpis.conversionRate}% converteram
            </span>
            <span>Contatos únicos por cliente</span>
          </div>
          <Sparkline
            values={chart.map((point) => point.leads)}
            color="#4f86e9"
          />
        </article>
        <article className={styles.metricCard}>
          <div className={styles.metricTop}>
            <span>Retorno sobre anúncios</span>
            <span className={styles.metricIcon}>
              <Target size={18} />
            </span>
          </div>
          <strong
            className={`${styles.metricValue} ${styles.unavailableValue}`}
          >
            {kpis.roas === null ? "—" : `${kpis.roas.toFixed(2)}×`}
          </strong>
          <div className={styles.metricFoot}>
            <span className={styles.neutralTag}>ROAS</span>
            <span>Requer investimento do período</span>
          </div>
          <button
            type="button"
            className={styles.metricInfoButton}
            onClick={() => setShowQuality((value) => !value)}
            aria-label="Entender disponibilidade do ROAS"
          >
            <CircleHelp size={16} />
          </button>
        </article>
      </section>

      {multiCurrency && (
        <div className={styles.currencyBreakdown}>
          {currentData.revenueByCurrency.map((row) => (
            <span key={row.currency}>
              <span>{row.currency}</span>
              <strong>{formatMoney(row.value, row.currency)}</strong>
            </span>
          ))}
        </div>
      )}

      <div className={styles.analyticsGrid}>
        <section
          className={styles.chartCard}
          aria-label="Evolução dos resultados"
        >
          <div className={styles.cardHeading}>
            <div>
              <h2>Seu desempenho, dia a dia</h2>
              <p>{currentData.rangeLabel}</p>
            </div>
            <div
              className={styles.segmented}
              role="group"
              aria-label="Métrica do gráfico"
            >
              {(
                [
                  { id: "receita", label: "Receita" },
                  { id: "conversas", label: "Contatos" },
                  { id: "vendas", label: "Vendas" },
                ] as const
              ).map((mode) => (
                <button
                  type="button"
                  key={mode.id}
                  onClick={() => setChartMode(mode.id)}
                  className={
                    effectiveChartMode === mode.id ? styles.segmentActive : ""
                  }
                  disabled={mode.id === "receita" && multiCurrency}
                  aria-pressed={effectiveChartMode === mode.id}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.chartSummary}>
            <strong>{chartValue(chartTotal)}</strong>
            <span>
              {effectiveChartMode === "receita"
                ? "receita registrada"
                : effectiveChartMode === "vendas"
                  ? "compras em produção"
                  : "novos contatos"}
              {dataQuality.chartLimited ? " · últimos 60 dias" : " no período"}
            </span>
            <span className={styles.chartLegend}>
              <i />
              {effectiveChartMode === "receita"
                ? "Receita"
                : effectiveChartMode === "vendas"
                  ? "Vendas"
                  : "Contatos"}
            </span>
          </div>
          <div className={styles.chartArea}>
            <div className={styles.chartAxis}>
              {[1, 0.75, 0.5, 0.25, 0].map((fraction) => (
                <span key={fraction}>
                  {effectiveChartMode === "receita"
                    ? chartMax * fraction >= 1000
                      ? `${((chartMax * fraction) / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`
                      : Math.round(chartMax * fraction).toLocaleString("pt-BR")
                    : Math.round(chartMax * fraction)}
                </span>
              ))}
            </div>
            <div className={styles.chartPlot}>
              <svg
                viewBox="0 0 1000 230"
                role="img"
                aria-label={`${effectiveChartMode === "receita" ? "Receita" : effectiveChartMode === "vendas" ? "Vendas" : "Contatos"} por dia. Total: ${chartValue(chartTotal)}.`}
                preserveAspectRatio="none"
                onMouseMove={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setHoveredPoint(
                    Math.max(
                      0,
                      Math.min(
                        chart.length - 1,
                        Math.round(
                          ((event.clientX - rect.left) / rect.width) *
                            (chart.length - 1),
                        ),
                      ),
                    ),
                  );
                }}
                onMouseLeave={() => setHoveredPoint(null)}
              >
                <defs>
                  <linearGradient
                    id="dashboard-area"
                    x1="0"
                    x2="0"
                    y1="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor="#7b39fc" stopOpacity=".19" />
                    <stop offset="100%" stopColor="#7b39fc" stopOpacity=".01" />
                  </linearGradient>
                </defs>
                {[38, 79.5, 121, 162.5, 204].map((y) => (
                  <line
                    key={y}
                    x1="0"
                    x2="1000"
                    y1={y}
                    y2={y}
                    className={styles.chartGrid}
                    strokeDasharray="4 6"
                  />
                ))}
                {area && <polygon points={area} fill="url(#dashboard-area)" />}
                {line && (
                  <polyline
                    points={line}
                    fill="none"
                    stroke="#7b39fc"
                    strokeWidth="3"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {hoveredPoint !== null && plot[hoveredPoint] && (
                  <>
                    <line
                      x1={plot[hoveredPoint].x}
                      x2={plot[hoveredPoint].x}
                      y1="20"
                      y2="214"
                      stroke="#aa86f0"
                      strokeDasharray="4 4"
                    />
                    <circle
                      cx={plot[hoveredPoint].x}
                      cy={plot[hoveredPoint].y}
                      r="5"
                      fill="#7b39fc"
                      stroke="white"
                      strokeWidth="3"
                      vectorEffect="non-scaling-stroke"
                    />
                  </>
                )}
              </svg>
              {hover && (
                <div
                  className={styles.chartTooltip}
                  style={{
                    left: `${Math.max(13, Math.min(87, ((hoveredPoint || 0) / Math.max(chart.length - 1, 1)) * 100))}%`,
                  }}
                >
                  <span>{hover.label}</span>
                  <strong>{chartValue(points[hoveredPoint || 0])}</strong>
                </div>
              )}
              <div className={styles.chartDates}>
                {chart
                  .filter(
                    (_, index) =>
                      index === 0 ||
                      index === chart.length - 1 ||
                      index % Math.max(1, Math.floor(chart.length / 5)) === 0,
                  )
                  .map((point) => (
                    <span key={point.date}>{point.label}</span>
                  ))}
              </div>
            </div>
          </div>
          <div className={styles.chartFooter}>
            <span>
              <span className={styles.greenDot} />
              Somente dados registrados em produção
            </span>
            <span>Fuso de São Paulo</span>
          </div>
        </section>

        <section
          className={styles.funnelCard}
          aria-label="Funil dos novos contatos"
        >
          <div className={styles.cardHeading}>
            <div>
              <h2>Do contato à venda</h2>
              <p>Funil dos novos contatos do período</p>
            </div>
            <TrendingUp size={18} className={styles.subtleIcon} />
          </div>
          <div className={styles.funnelList}>
            {funnel.map((step, index) => (
              <div className={styles.funnelStep} key={step.name}>
                <div className={styles.funnelStepTop}>
                  <span>
                    <i className={styles.funnelIndex}>
                      {String(index + 1).padStart(2, "0")}
                    </i>
                    {step.name}
                  </span>
                  <strong>{formatNumber(step.count)}</strong>
                </div>
                <div className={styles.funnelTrack}>
                  <span
                    style={{
                      width: `${step.percent}%`,
                      opacity: 1 - index * 0.13,
                    }}
                  />
                </div>
                <div className={styles.funnelPercent}>
                  {step.percent}% dos novos contatos
                </div>
              </div>
            ))}
          </div>
          <div className={styles.funnelResult}>
            <div>
              <span>Conversão em compra</span>
              <strong>{kpis.conversionRate.toLocaleString("pt-BR")}%</strong>
            </div>
            <span className={styles.funnelResultIcon}>
              <ArrowUpRight size={23} />
            </span>
          </div>
        </section>
      </div>

      <section
        className={styles.performanceCard}
        aria-label="Desempenho por anúncio"
      >
        <div className={styles.performanceHeader}>
          <div>
            <h2>Onde seus resultados acontecem</h2>
            <p>Contatos e compras organizados por origem.</p>
          </div>
          <div className={styles.performanceActions}>
            <button
              type="button"
              onClick={() => {
                void handleCopy();
              }}
              title="Copiar resumo do período"
              aria-label="Copiar resumo do período"
            >
              <Copy size={16} />
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              title="Imprimir ou salvar PDF"
              aria-label="Imprimir ou salvar PDF"
            >
              <Printer size={16} />
            </button>
          </div>
        </div>
        <div
          className={styles.campaignControls}
          aria-label="Filtros de campanhas"
        >
          <label className={styles.campaignStatusFilter}>
            Status da campanha
            <select
              aria-label="Status das campanhas"
              disabled={isSyncing || isLoadingCampaigns}
              value={campaignStatus}
              onChange={(event) => {
                setCampaignStatus(
                  event.target.value as "active" | "paused" | "all",
                );
                setCampaignIds([]);
                setPage(1);
              }}
            >
              <option value="active">Somente ativas</option>
              <option value="paused">Somente pausadas</option>
              <option value="all">Todos os status</option>
            </select>
          </label>
          <details className={styles.campaignPicker}>
            <summary>
              Selecionar campanhas{" "}
              <span>
                {campaignIds.length
                  ? `${campaignIds.length} selecionada(s)`
                  : "Todas do status"}
              </span>
              <ChevronDown size={14} />
            </summary>
            <div className={styles.campaignPickerPanel}>
              <input
                type="search"
                aria-label="Buscar campanhas para selecionar"
                placeholder="Nome ou ID da campanha…"
                value={campaignSearch}
                onChange={(event) => setCampaignSearch(event.target.value)}
              />
              <button type="button" onClick={() => setCampaignIds([])}>
                Usar todas deste status
              </button>
              {!clientId && (
                <p className={styles.campaignScope}>
                  Selecione uma empresa no filtro acima para escolher campanhas
                  específicas da conta.
                </p>
              )}
              <div className={styles.campaignOptions}>
                {availableCampaigns.map((campaign) => (
                  <label key={`${campaign.clientId}:${campaign.id}`}>
                    <input
                      type="checkbox"
                      aria-label={`Selecionar campanha ${campaign.name}`}
                      checked={campaignIds.includes(campaign.id)}
                      disabled={
                        !clientId ||
                        isSyncing ||
                        isLoadingCampaigns ||
                        (!campaignIds.includes(campaign.id) &&
                          campaignIds.length >= 200)
                      }
                      onChange={(event) => {
                        setCampaignIds((previous) =>
                          event.target.checked
                            ? [...new Set([...previous, campaign.id])]
                            : previous.filter((id) => id !== campaign.id),
                        );
                        setPage(1);
                      }}
                    />
                    <span>
                      <strong>{campaign.name}</strong>
                      <small>
                        {campaign.clientName} · {campaign.id}
                      </small>
                    </span>
                  </label>
                ))}
                {!availableCampaigns.length && (
                  <p>
                    Nenhuma campanha disponível neste filtro. Carregue as
                    campanhas da conta ou altere o status.
                  </p>
                )}
              </div>
            </div>
          </details>
          <button
            type="button"
            className={styles.filterButton}
            disabled={isLoadingCampaigns || isSyncing}
            onClick={() => void handleLoadCampaigns()}
          >
            {isLoadingCampaigns ? (
              <LoaderCircle size={15} className={styles.spin} />
            ) : (
              <RefreshCw size={15} />
            )}{" "}
            {isLoadingCampaigns
              ? "Carregando campanhas…"
              : "Carregar campanhas da conta"}
          </button>
          {!!campaignIds.length && (
            <button
              type="button"
              className={styles.resetButton}
              onClick={() => {
                setCampaignIds([]);
                setPage(1);
              }}
            >
              <X size={13} />
              Limpar seleção
            </button>
          )}
        </div>
        <p className={styles.campaignScope}>
          Status e seleção filtram esta tabela e a sincronização da Meta. Os
          indicadores gerais acima mantêm todos os contatos e vendas do período.
          Campanha ativa pode conter anúncios pausados.
        </p>
        {currentData.campaignCatalogSyncedAt && (
          <p className={styles.campaignScope}>
            Catálogo consultado:{" "}
            {formatDateTime(currentData.campaignCatalogSyncedAt)}. Use “Carregar
            campanhas da conta” para atualizar os status na Meta.
          </p>
        )}
        {!!currentData.campaignCatalogWarnings.length && (
          <div className={styles.campaignWarning} role="status">
            {currentData.campaignCatalogWarnings.join(" ")}
          </div>
        )}
        <div className={styles.tableToolbar}>
          <div
            className={styles.tabs}
            role="tablist"
            aria-label="Agrupamento dos resultados"
          >
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                className={activeTab === tab.id ? styles.tabActive : ""}
                onClick={() => {
                  setActiveTab(tab.id);
                  setPage(1);
                }}
              >
                {tab.label}
                <span>
                  {
                    currentData[
                      tab.id === "campanhas"
                        ? "campaigns"
                        : tab.id === "conjuntos"
                          ? "adsets"
                          : "ads"
                    ].length
                  }
                </span>
              </button>
            ))}
          </div>
          <label className={styles.tableSearch}>
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="Buscar campanha ou anúncio…"
              aria-label="Buscar nos resultados"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setPage(1);
                }}
                aria-label="Limpar busca"
              >
                <X size={13} />
              </button>
            )}
          </label>
        </div>
        <div
          className={styles.tableScroll}
          role="tabpanel"
          aria-label={TABS.find((tab) => tab.id === activeTab)?.label}
        >
          <table className={styles.performanceTable}>
            <thead>
              <tr>
                <th>
                  {activeTab === "campanhas"
                    ? "Campanha"
                    : activeTab === "conjuntos"
                      ? "Conjunto de anúncios"
                      : "Anúncio"}
                </th>
                {activeTab === "campanhas" && <th>Status</th>}
                <th>
                  <button type="button" onClick={() => changeSort("leads")}>
                    Contatos{" "}
                    {sortKey === "leads" && (
                      <ChevronDown
                        size={12}
                        className={!sortDescending ? styles.reversed : ""}
                      />
                    )}
                  </button>
                </th>
                <th>
                  <button type="button" onClick={() => changeSort("purchases")}>
                    Vendas{" "}
                    {sortKey === "purchases" && (
                      <ChevronDown
                        size={12}
                        className={!sortDescending ? styles.reversed : ""}
                      />
                    )}
                  </button>
                </th>
                <th>
                  <button type="button" onClick={() => changeSort("revenue")}>
                    Receita{" "}
                    {sortKey === "revenue" && (
                      <ChevronDown
                        size={12}
                        className={!sortDescending ? styles.reversed : ""}
                      />
                    )}
                  </button>
                </th>
                <th>
                  ROAS{" "}
                  <span title="Requer investimento diário correspondente ao período">
                    <CircleHelp size={12} />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, index) => (
                <tr key={row.id}>
                  <td>
                    <div className={styles.campaignName}>
                      {row.image ? (
                        <img
                          src={row.image}
                          alt=""
                          className={styles.creativeImage}
                        />
                      ) : (
                        <span
                          className={`${styles.campaignIcon} ${index % 3 === 1 ? styles.campaignIconBlue : index % 3 === 2 ? styles.campaignIconGreen : ""}`}
                        >
                          <BarChart3 size={17} />
                        </span>
                      )}
                      <span>
                        <strong>{row.name}</strong>
                        <small>
                          {row.detail}
                          {activeTab !== "campanhas" && ` · ${row.client}`}
                        </small>
                      </span>
                    </div>
                  </td>
                  {activeTab === "campanhas" && (
                    <td>
                      <span
                        className={
                          row.status === "ACTIVE"
                            ? styles.activeStatus
                            : styles.neutralStatus
                        }
                      >
                        <i />
                        {row.status === "ACTIVE"
                          ? "Ativa"
                          : row.status === "PAUSED"
                            ? "Pausada"
                            : row.status === "ARCHIVED"
                              ? "Arquivada"
                              : "Não informado"}
                      </span>
                    </td>
                  )}
                  <td>{formatNumber(row.leads)}</td>
                  <td>
                    <span className={styles.purchaseCount}>
                      {formatNumber(row.purchases)}
                    </span>
                  </td>
                  <td className={styles.revenueCell}>
                    {formatMoney(row.revenue, row.currency)}
                  </td>
                  <td className={styles.emptyRoas}>—</td>
                </tr>
              ))}
              {!visibleRows.length && (
                <tr>
                  <td colSpan={activeTab === "campanhas" ? 6 : 5}>
                    <div className={styles.emptyState}>
                      <span className={styles.emptyIcon}>
                        <Search size={23} />
                      </span>
                      <strong>
                        {query
                          ? "Nenhum resultado para essa busca"
                          : "Nenhum resultado neste filtro"}
                      </strong>
                      <p>
                        {query
                          ? "Tente outro nome de campanha, anúncio ou cliente."
                          : "Carregue as campanhas da conta e confira o status e a seleção. As campanhas também podem aparecer sem contatos registrados."}
                      </p>
                      {!currentData.clients.length && (
                        <Link
                          href="/clientes/novo"
                          className={styles.primaryButton}
                        >
                          Cadastrar cliente
                          <ArrowRight size={14} />
                        </Link>
                      )}
                      {query && (
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={() => setQuery("")}
                        >
                          Limpar busca
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className={styles.tableFooter}>
          <span>
            {filteredRows.length
              ? `${(currentPage - 1) * 6 + 1}–${Math.min(currentPage * 6, filteredRows.length)} de ${filteredRows.length} resultados`
              : "Nenhum resultado"}
          </span>
          <div>
            <button
              type="button"
              aria-label="Página anterior"
              disabled={currentPage <= 1}
              onClick={() => setPage(currentPage - 1)}
            >
              <ChevronLeft size={15} />
            </button>
            <span>
              Página {currentPage} de {maxPage}
            </span>
            <button
              type="button"
              aria-label="Próxima página"
              disabled={currentPage >= maxPage}
              onClick={() => setPage(currentPage + 1)}
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </section>

      <div className={styles.bottomGrid}>
        <div className={styles.insightCard}>
          <span className={styles.insightIcon}>
            <Target size={20} />
          </span>
          <div>
            <h3>Ticket médio por compra</h3>
            <p>
              {multiCurrency
                ? "Consulte a receita de cada moeda separadamente."
                : "Valor médio dos eventos de compra no período."}
            </p>
          </div>
          <strong>{formatMoney(kpis.averageTicket, currency)}</strong>
        </div>
        <div className={styles.insightCard}>
          <span className={`${styles.insightIcon} ${styles.greenIcon}`}>
            <CheckCircle2 size={20} />
          </span>
          <div>
            <h3>Origem das compras</h3>
            <p>
              {currentData.unattributedPurchases
                ? `${currentData.unattributedPurchases} compra(s) sem origem salva no evento.`
                : hasData
                  ? "As compras com origem estão organizadas por anúncio."
                  : "Os dados de origem aparecem junto dos eventos."}
            </p>
          </div>
          <strong>{dataQuality.attributionCoverage}%</strong>
        </div>
      </div>

      <div className={styles.dataNote}>
        <button
          type="button"
          onClick={() => setShowQuality((value) => !value)}
          aria-expanded={showQuality}
        >
          <Info size={14} /> Como estes resultados são calculados
          <ChevronDown
            size={13}
            className={showQuality ? styles.reversed : ""}
          />
        </button>
        <span>
          Atualizado em {formatDateTime(currentData.generatedAt)}
          <button
            type="button"
            onClick={() => setRefreshTick((tick) => tick + 1)}
            disabled={isRefreshing}
            aria-label="Atualizar resultados agora"
          >
            <RefreshCw size={12} className={isRefreshing ? styles.spin : ""} />
          </button>
        </span>
      </div>
      {showQuality && (
        <div className={styles.qualityPanel}>
          <h3>Resultados claros, sem estimativas escondidas</h3>
          <p>
            Receita e vendas consideram somente eventos Purchase aceitos em
            produção, contando cada identificador uma vez. Eventos de teste e
            tentativas repetidas ficam fora dos totais.
          </p>
          <p>
            ROAS, investimento, CPA e lucro aguardam dados de investimento do
            mesmo período. O gasto acumulado de um anúncio não é comparado com a
            receita de alguns dias.
          </p>
          <p>
            {currentData.attributionNote} O funil acompanha apenas os novos
            contatos do período, usando respostas e eventos registrados. A
            conversão conta compradores únicos desse grupo.
          </p>
          <div>
            <span>
              {dataQuality.excludedTestEvents} evento(s) de teste excluído(s)
            </span>
            <span>
              {dataQuality.duplicateAttempts} tentativa(s) repetida(s)
              desconsiderada(s)
            </span>
            {dataQuality.chartLimited && (
              <span>
                Gráfico limitado aos últimos 60 dias; totais preservados
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
