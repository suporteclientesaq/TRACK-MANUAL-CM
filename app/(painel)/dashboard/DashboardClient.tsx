"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  DollarSign,
  Layers,
  MessageSquare,
  Percent,
  RefreshCw,
  Search,
  ShoppingCart,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
} from "lucide-react";
import { ActionProgressModal } from "@/components/ActionProgressModal";
import { Button } from "@/components/ui/button";
import type { DashboardData } from "@/lib/dashboard";
import { formatMoney, formatNumber } from "@/lib/format";

interface DashboardClientProps {
  data: DashboardData;
}

export function DashboardClient({ data }: DashboardClientProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"campanhas" | "conjuntos" | "anuncios" | "funil">("campanhas");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const [hoveredPoint, setHoveredPoint] = useState<number | null>(null);

  const { kpis, chart, campaigns, adsets, ads, funnel, currency } = data;

  const handlePeriodChange = (p: string) => {
    const params = new URLSearchParams(window.location.search);
    params.set("periodo", p);
    router.push(`/dashboard?${params.toString()}`);
  };

  const handleClientChange = (cId: string) => {
    const params = new URLSearchParams(window.location.search);
    if (cId) params.set("cliente", cId);
    else params.delete("cliente");
    router.push(`/dashboard?${params.toString()}`);
  };

  const syncSteps = [
    { label: "Conectando à API do Meta…", threshold: 25 },
    { label: "Buscando métricas da Conta de Anúncios…", threshold: 55 },
    { label: "Cruzando vendas e cliques (ctwa_clid)…", threshold: 85 },
    { label: "Atualizando métricas de ROI e funil…", threshold: 100 },
  ];

  // Cálculo de escala do gráfico
  const maxVal = Math.max(...chart.map((c) => Math.max(c.revenue, c.spend)), 100);

  // Filtros de busca nas tabelas
  const filteredCampaigns = campaigns.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredAdSets = adsets.filter((a) =>
    a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.campaign_name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredAds = ads.filter((a) =>
    a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.campaign_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Modal de Progresso 1% a 100% */}
      <ActionProgressModal
        isOpen={isSyncing}
        title="Sincronização com o Meta"
        steps={syncSteps}
        onClose={() => {
          setIsSyncing(false);
          router.refresh();
        }}
      />

      {/* Cabeçalho do Dashboard */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "16px",
          paddingBottom: "8px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 800 }}>Dashboard de Atribuição</h1>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                padding: "3px 9px",
                borderRadius: "999px",
                background: "linear-gradient(90deg, rgba(123, 57, 252, 0.25), rgba(52, 199, 123, 0.25))",
                color: "#b394ff",
                border: "1px solid rgba(123, 57, 252, 0.4)",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <Sparkles size={12} />
              MODELO UTMFY
            </span>
          </div>
          <p className="muted small" style={{ margin: "4px 0 0 0" }}>
            Métricas em tempo real de anúncios Click-to-WhatsApp, vendas rastreadas e ROAS ponta a ponta.
          </p>
        </div>

        {/* Controles de Filtro e Sincronização */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
          {/* Seletor de Cliente */}
          {data.clients.length > 1 && (
            <select
              value={data.filterClient || ""}
              onChange={(e) => handleClientChange(e.target.value)}
              style={{
                padding: "7px 12px",
                borderRadius: "8px",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                color: "var(--text)",
                fontSize: "13px",
              }}
            >
              <option value="">Todos os Clientes</option>
              {data.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}

          {/* Filtros Rápidos de Período */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: "var(--surface)",
              borderRadius: "8px",
              border: "1px solid var(--border)",
              padding: "3px",
              gap: "2px",
            }}
          >
            {[
              { id: "hoje", label: "Hoje" },
              { id: "ontem", label: "Ontem" },
              { id: "7d", label: "7 Dias" },
              { id: "30d", label: "30 Dias" },
              { id: "mes", label: "Este Mês" },
              { id: "todos", label: "Tudo" },
            ].map((p) => {
              const active = data.filterPeriod === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => handlePeriodChange(p.id)}
                  style={{
                    background: active ? "var(--brand)" : "transparent",
                    color: active ? "#ffffff" : "var(--text-muted)",
                    border: "none",
                    borderRadius: "6px",
                    padding: "5px 11px",
                    fontSize: "12px",
                    fontWeight: active ? 700 : 500,
                    cursor: "pointer",
                    transition: "all 150ms ease",
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {/* Botão de Sincronização com Barra de Progresso 1-100% */}
          <Button
            size="sm"
            onClick={() => setIsSyncing(true)}
            style={{
              background: "linear-gradient(90deg, #7b39fc 0%, #6825ee 100%)",
              color: "#fff",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              boxShadow: "0 0 15px rgba(123, 57, 252, 0.4)",
              fontWeight: 600,
            }}
          >
            <RefreshCw size={14} className={isSyncing ? "animate-spin" : undefined} />
            Sincronizar com Meta
          </Button>
        </div>
      </div>

      {/* Grid Principal de KPIs (Cards Estilo UTMfy) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "14px",
        }}
      >
        {/* Card 1: Faturamento Total */}
        <div
          className="card"
          style={{
            position: "relative",
            overflow: "hidden",
            border: "1px solid rgba(52, 199, 123, 0.35)",
            background: "linear-gradient(145deg, rgba(52, 199, 123, 0.08), rgba(21, 18, 29, 0.95))",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "#9a92ad" }}>Faturamento Total</span>
            <div
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "8px",
                background: "rgba(52, 199, 123, 0.2)",
                color: "#34c77b",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <DollarSign size={16} />
            </div>
          </div>
          <div style={{ fontSize: "24px", fontWeight: 800, color: "#34c77b" }}>
            {formatMoney(kpis.revenue, currency)}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "8px", fontSize: "12px", color: "#9a92ad" }}>
            <span style={{ color: "#34c77b", fontWeight: 600, display: "flex", alignItems: "center" }}>
              <ArrowUpRight size={14} /> {kpis.purchases}
            </span>
            <span>vendas aprovadas</span>
          </div>
        </div>

        {/* Card 2: Gasto em Anúncios */}
        <div
          className="card"
          style={{
            position: "relative",
            overflow: "hidden",
            border: "1px solid rgba(123, 57, 252, 0.35)",
            background: "linear-gradient(145deg, rgba(123, 57, 252, 0.08), rgba(21, 18, 29, 0.95))",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "#9a92ad" }}>Gasto Meta Ads</span>
            <div
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "8px",
                background: "rgba(123, 57, 252, 0.2)",
                color: "#b394ff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <TrendingUp size={16} />
            </div>
          </div>
          <div style={{ fontSize: "24px", fontWeight: 800, color: "#ebe8f2" }}>
            {formatMoney(kpis.spend, currency)}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "8px", fontSize: "12px", color: "#9a92ad" }}>
            <span>Investimento em tráfego</span>
          </div>
        </div>

        {/* Card 3: ROAS Real */}
        <div
          className="card"
          style={{
            position: "relative",
            overflow: "hidden",
            border: "1px solid rgba(0, 242, 254, 0.35)",
            background: "linear-gradient(145deg, rgba(0, 242, 254, 0.08), rgba(21, 18, 29, 0.95))",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "#9a92ad" }}>ROAS Real</span>
            <div
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "8px",
                background: "rgba(0, 242, 254, 0.2)",
                color: "#00f2fe",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Zap size={16} />
            </div>
          </div>
          <div
            style={{
              fontSize: "24px",
              fontWeight: 800,
              color: kpis.roas >= 2 ? "#34c77b" : kpis.roas >= 1 ? "#e3a72f" : "#ef5a5a",
              display: "flex",
              alignItems: "baseline",
              gap: "6px",
            }}
          >
            {kpis.roas.toFixed(2)}x
            <span
              style={{
                fontSize: "11px",
                padding: "2px 7px",
                borderRadius: "999px",
                background: kpis.roas >= 2 ? "rgba(52, 199, 123, 0.2)" : "rgba(227, 167, 47, 0.2)",
                color: kpis.roas >= 2 ? "#34c77b" : "#e3a72f",
                fontWeight: 700,
              }}
            >
              {kpis.roas >= 2 ? "ESCALA ALTA" : "EQUILÍBRIO"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "8px", fontSize: "12px", color: "#9a92ad" }}>
            <span>ROI: {kpis.roiPercent > 0 ? `+${kpis.roiPercent}%` : `${kpis.roiPercent}%`}</span>
          </div>
        </div>

        {/* Card 4: Leads & CPA */}
        <div className="card" style={{ position: "relative", overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "#9a92ad" }}>Leads / WhatsApp</span>
            <div
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "8px",
                background: "rgba(255, 255, 255, 0.08)",
                color: "#ebe8f2",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <MessageSquare size={16} />
            </div>
          </div>
          <div style={{ fontSize: "24px", fontWeight: 800, color: "#ebe8f2" }}>
            {formatNumber(kpis.leads)}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "8px", fontSize: "12px", color: "#9a92ad" }}>
            <span>Conv: {kpis.conversionRate}%</span>
            <span>Ticket: {formatMoney(kpis.averageTicket, currency)}</span>
          </div>
        </div>
      </div>

      {/* Gráfico Animado de Desempenho Diário */}
      <div className="card" style={{ padding: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "17px", fontWeight: 700 }}>Evolução Diária de Conversões</h2>
            <p className="muted small" style={{ margin: "2px 0 0 0" }}>
              Comparativo visual entre investimento e faturamento rastreado.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "16px", fontSize: "12px" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ width: "10px", height: "10px", borderRadius: "2px", background: "#34c77b" }} />
              Faturamento
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ width: "10px", height: "10px", borderRadius: "2px", background: "#7b39fc" }} />
              Investimento
            </span>
          </div>
        </div>

        {/* Visualização de Gráfico em Barras Dinâmicas */}
        <div
          style={{
            height: "180px",
            display: "flex",
            alignItems: "flex-end",
            gap: "8px",
            paddingTop: "20px",
            borderBottom: "1px solid var(--border)",
            position: "relative",
          }}
        >
          {chart.map((point, index) => {
            const revHeight = maxVal > 0 ? (point.revenue / maxVal) * 140 : 4;
            const spendHeight = maxVal > 0 ? (point.spend / maxVal) * 140 : 4;
            const isHovered = hoveredPoint === index;

            return (
              <div
                key={point.date}
                onMouseEnter={() => setHoveredPoint(index)}
                onMouseLeave={() => setHoveredPoint(null)}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  height: "100%",
                  justifyContent: "flex-end",
                  cursor: "pointer",
                  position: "relative",
                }}
              >
                {/* Tooltip ao passar o mouse */}
                {isHovered && (
                  <div
                    style={{
                      position: "absolute",
                      bottom: "100%",
                      marginBottom: "8px",
                      background: "rgba(21, 18, 29, 0.95)",
                      border: "1px solid var(--border-strong)",
                      borderRadius: "8px",
                      padding: "8px 12px",
                      fontSize: "11px",
                      boxShadow: "0 10px 25px rgba(0, 0, 0, 0.6)",
                      zIndex: 10,
                      whiteSpace: "nowrap",
                      pointerEvents: "none",
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: "4px" }}>{point.label}</div>
                    <div style={{ color: "#34c77b" }}>Vendas: {formatMoney(point.revenue, currency)} ({point.sales})</div>
                    <div style={{ color: "#b394ff" }}>Gasto: {formatMoney(point.spend, currency)}</div>
                    <div style={{ color: "#9a92ad" }}>Leads: {point.leads}</div>
                  </div>
                )}

                {/* Barras lado a lado */}
                <div style={{ display: "flex", alignItems: "flex-end", gap: "2px", width: "100%", justifyContent: "center" }}>
                  {/* Barra de Faturamento */}
                  <div
                    style={{
                      width: "45%",
                      maxWidth: "14px",
                      height: `${Math.max(revHeight, 4)}px`,
                      background: "linear-gradient(180deg, #34c77b 0%, rgba(52, 199, 123, 0.3) 100%)",
                      borderRadius: "3px 3px 0 0",
                      transition: "height 300ms ease, opacity 200ms ease",
                      opacity: isHovered ? 1 : 0.85,
                      boxShadow: isHovered ? "0 0 8px #34c77b" : "none",
                    }}
                  />
                  {/* Barra de Gasto */}
                  <div
                    style={{
                      width: "45%",
                      maxWidth: "14px",
                      height: `${Math.max(spendHeight, 4)}px`,
                      background: "linear-gradient(180deg, #7b39fc 0%, rgba(123, 57, 252, 0.3) 100%)",
                      borderRadius: "3px 3px 0 0",
                      transition: "height 300ms ease, opacity 200ms ease",
                      opacity: isHovered ? 1 : 0.85,
                      boxShadow: isHovered ? "0 0 8px #7b39fc" : "none",
                    }}
                  />
                </div>
                {/* Rótulo da data */}
                <span
                  style={{
                    fontSize: "10px",
                    color: isHovered ? "#ebe8f2" : "#6d6582",
                    marginTop: "6px",
                    fontFamily: "var(--font-mono, monospace)",
                  }}
                >
                  {index % Math.ceil(chart.length / 10) === 0 ? point.label : ""}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Abas e Tabelas Detalhadas Estilo UTMfy */}
      <div className="card" style={{ padding: "0" }}>
        {/* Navegação entre Abas */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid var(--border)",
            padding: "12px 18px",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", gap: "6px" }}>
            {[
              { id: "campanhas", label: "Campanhas", icon: Layers },
              { id: "conjuntos", label: "Conjuntos (AdSets)", icon: Target },
              { id: "anuncios", label: "Criativos (Ads)", icon: BarChart3 },
              { id: "funil", label: "Funil de Conversão", icon: TrendingUp },
            ].map((t) => {
              const active = activeTab === t.id;
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id as any)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "7px 14px",
                    borderRadius: "8px",
                    border: "none",
                    background: active ? "var(--surface-2)" : "transparent",
                    color: active ? "var(--text)" : "var(--text-muted)",
                    fontWeight: active ? 700 : 500,
                    fontSize: "13px",
                    cursor: "pointer",
                    transition: "all 150ms ease",
                  }}
                >
                  <Icon size={15} color={active ? "var(--brand)" : undefined} />
                  {t.label}
                </button>
              );
            })}
          </div>

          {activeTab !== "funil" && (
            <div style={{ position: "relative", minWidth: "220px" }}>
              <input
                type="text"
                placeholder="Filtrar por nome…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: "100%",
                  padding: "6px 10px 6px 30px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                }}
              />
              <Search
                size={14}
                style={{
                  position: "absolute",
                  left: "9px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "#9a92ad",
                }}
              />
            </div>
          )}
        </div>

        {/* Conteúdo da Aba: Campanhas */}
        {activeTab === "campanhas" && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Campanha</th>
                  <th>Status</th>
                  <th>Gasto</th>
                  <th>Leads</th>
                  <th>Vendas</th>
                  <th>Faturamento</th>
                  <th>CPA</th>
                  <th>ROAS</th>
                </tr>
              </thead>
              <tbody>
                {filteredCampaigns.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: "center", padding: "32px", color: "#9a92ad" }}>
                      Nenhuma campanha encontrada para este período.
                    </td>
                  </tr>
                ) : (
                  filteredCampaigns.map((camp) => (
                    <tr key={camp.id}>
                      <td style={{ fontWeight: 600 }}>{camp.name}</td>
                      <td>
                        <span className="badge badge-ok">{camp.status}</span>
                      </td>
                      <td className="mono">{formatMoney(camp.spend, currency)}</td>
                      <td>{formatNumber(camp.leads)}</td>
                      <td>
                        <strong style={{ color: "#34c77b" }}>{camp.purchases}</strong>
                      </td>
                      <td className="mono" style={{ fontWeight: 700, color: "#34c77b" }}>
                        {formatMoney(camp.revenue, currency)}
                      </td>
                      <td className="mono">{formatMoney(camp.cpa, currency)}</td>
                      <td>
                        <span
                          style={{
                            fontSize: "12px",
                            fontWeight: 700,
                            padding: "3px 8px",
                            borderRadius: "6px",
                            background: camp.roas >= 2 ? "rgba(52, 199, 123, 0.15)" : "rgba(227, 167, 47, 0.15)",
                            color: camp.roas >= 2 ? "#34c77b" : "#e3a72f",
                          }}
                        >
                          {camp.roas.toFixed(2)}x
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Conteúdo da Aba: Conjuntos (AdSets) */}
        {activeTab === "conjuntos" && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Conjunto de Anúncios</th>
                  <th>Campanha</th>
                  <th>Gasto</th>
                  <th>Leads</th>
                  <th>Vendas</th>
                  <th>Faturamento</th>
                  <th>ROAS</th>
                </tr>
              </thead>
              <tbody>
                {filteredAdSets.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", padding: "32px", color: "#9a92ad" }}>
                      Nenhum conjunto encontrado para este período.
                    </td>
                  </tr>
                ) : (
                  filteredAdSets.map((adset) => (
                    <tr key={adset.id}>
                      <td style={{ fontWeight: 600 }}>{adset.name}</td>
                      <td className="muted small">{adset.campaign_name}</td>
                      <td className="mono">{formatMoney(adset.spend, currency)}</td>
                      <td>{formatNumber(adset.leads)}</td>
                      <td>{adset.purchases}</td>
                      <td className="mono" style={{ fontWeight: 700, color: "#34c77b" }}>
                        {formatMoney(adset.revenue, currency)}
                      </td>
                      <td>
                        <span
                          style={{
                            fontSize: "12px",
                            fontWeight: 700,
                            padding: "3px 8px",
                            borderRadius: "6px",
                            background: adset.roas >= 2 ? "rgba(52, 199, 123, 0.15)" : "rgba(227, 167, 47, 0.15)",
                            color: adset.roas >= 2 ? "#34c77b" : "#e3a72f",
                          }}
                        >
                          {adset.roas.toFixed(2)}x
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Conteúdo da Aba: Criativos (Ads) */}
        {activeTab === "anuncios" && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Criativo / Anúncio</th>
                  <th>Campanha</th>
                  <th>Gasto</th>
                  <th>Conversas</th>
                  <th>Vendas</th>
                  <th>Faturamento</th>
                  <th>ROAS</th>
                </tr>
              </thead>
              <tbody>
                {filteredAds.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", padding: "32px", color: "#9a92ad" }}>
                      Nenhum criativo encontrado para este período.
                    </td>
                  </tr>
                ) : (
                  filteredAds.map((ad) => (
                    <tr key={ad.id}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          {ad.thumbnail_url ? (
                            <img
                              src={ad.thumbnail_url}
                              alt=""
                              style={{ width: "36px", height: "36px", borderRadius: "6px", objectFit: "cover" }}
                            />
                          ) : (
                            <div
                              style={{
                                width: "36px",
                                height: "36px",
                                borderRadius: "6px",
                                background: "var(--surface-2)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: "#9a92ad",
                              }}
                            >
                              <BarChart3 size={18} />
                            </div>
                          )}
                          <div>
                            <div style={{ fontWeight: 600 }}>{ad.name}</div>
                            {ad.creative_title && <div className="muted small">{ad.creative_title}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="muted small">{ad.campaign_name}</td>
                      <td className="mono">{formatMoney(ad.spend, currency)}</td>
                      <td>{formatNumber(ad.conversations)}</td>
                      <td>{ad.purchases}</td>
                      <td className="mono" style={{ fontWeight: 700, color: "#34c77b" }}>
                        {formatMoney(ad.revenue, currency)}
                      </td>
                      <td>
                        <span
                          style={{
                            fontSize: "12px",
                            fontWeight: 700,
                            padding: "3px 8px",
                            borderRadius: "6px",
                            background: ad.roas >= 2 ? "rgba(52, 199, 123, 0.15)" : "rgba(227, 167, 47, 0.15)",
                            color: ad.roas >= 2 ? "#34c77b" : "#e3a72f",
                          }}
                        >
                          {ad.roas.toFixed(2)}x
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Conteúdo da Aba: Funil de Mensagens */}
        {activeTab === "funil" && (
          <div style={{ padding: "28px" }}>
            <div style={{ maxWidth: "680px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "16px" }}>
              <h3 style={{ margin: "0 0 16px 0", fontSize: "16px", textAlign: "center" }}>
                Funil de Conversão Click-to-WhatsApp
              </h3>

              {funnel.map((step, idx) => (
                <div key={idx} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", fontWeight: 600 }}>
                    <span>{step.name}</span>
                    <span style={{ color: "#34c77b" }}>
                      {formatNumber(step.count)} ({step.percent}%)
                    </span>
                  </div>
                  <div
                    style={{
                      height: "12px",
                      width: "100%",
                      background: "rgba(255, 255, 255, 0.06)",
                      borderRadius: "999px",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.max(step.percent, 3)}%`,
                        background:
                          idx === 3
                            ? "linear-gradient(90deg, #34c77b, #00f2fe)"
                            : "linear-gradient(90deg, #7b39fc, #34c77b)",
                        borderRadius: "999px",
                        transition: "width 600ms cubic-bezier(0.1, 0.9, 0.2, 1)",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
