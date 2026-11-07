"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowUpRight,
  BadgeCheck,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  DollarSign,
  ExternalLink,
  Flame,
  Globe,
  HelpCircle,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  TrendingUp,
  User,
  Zap,
} from "lucide-react";
import { sendEventAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatMoney, formatPhone } from "@/lib/format";
import type { Lead } from "@/lib/types";

interface ClientBasic {
  id: string;
  name: string;
  default_currency: string;
}

interface ConversasClientProps {
  clients: ClientBasic[];
  initialLeads: Lead[];
  adsData: Record<string, any>;
  eventsData: Record<string, any[]>;
  clientNameMap: Record<string, string>;
  initialSelectedLeadId: string | null;
  initialClientId: string;
  initialSearchQuery: string;
}

export function ConversasClient({
  clients,
  initialLeads,
  adsData,
  eventsData,
  clientNameMap,
  initialSelectedLeadId,
  initialClientId,
  initialSearchQuery,
}: ConversasClientProps) {
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(initialSelectedLeadId);
  const [clientFilter, setClientFilter] = useState<string>(initialClientId);
  const [searchQuery, setSearchQuery] = useState<string>(initialSearchQuery);
  const [activeTab, setActiveTab] = useState<"todos" | "com-anuncio" | "com-venda" | "sem-venda">("todos");

  // Estado para envio rápido de conversão CAPI
  const [saleValue, setSaleValue] = useState<string>("197,00");
  const [sendingSale, setSendingSale] = useState(false);
  const [saleNotice, setSaleNotice] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showRightPanel, setShowRightPanel] = useState(true);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Filtra os leads em memória para resposta instantânea
  const filteredLeads = useMemo(() => {
    return initialLeads.filter((lead) => {
      // Filtro de cliente
      if (clientFilter && lead.client_id !== clientFilter) return false;

      // Filtro de texto (nome, telefone, anúncio)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const nameMatch = lead.name?.toLowerCase().includes(q);
        const phoneMatch = lead.phone.includes(q);
        const adMatch = lead.source_id?.includes(q);
        const notesMatch = lead.notes?.toLowerCase().includes(q);
        if (!nameMatch && !phoneMatch && !adMatch && !notesMatch) return false;
      }

      // Filtro de abas
      const hasPurchased = (eventsData[lead.id] || []).some((e) => e.event_name === "Purchase");
      const hasAd = Boolean(lead.ctwa_clid || lead.source_id);

      if (activeTab === "com-anuncio" && !hasAd) return false;
      if (activeTab === "com-venda" && !hasPurchased) return false;
      if (activeTab === "sem-venda" && hasPurchased) return false;

      return true;
    });
  }, [initialLeads, clientFilter, searchQuery, activeTab, eventsData]);

  // Lead selecionado atual
  const selectedLead = useMemo(() => {
    if (!selectedLeadId) return filteredLeads[0] || initialLeads[0] || null;
    return initialLeads.find((l) => l.id === selectedLeadId) || filteredLeads[0] || null;
  }, [selectedLeadId, initialLeads, filteredLeads]);

  // Dados do anúncio do lead ativo
  const selectedAd = useMemo(() => {
    if (!selectedLead || !selectedLead.source_id) return null;
    return adsData[`${selectedLead.client_id}:${selectedLead.source_id}`] || null;
  }, [selectedLead, adsData]);

  // Eventos enviados do lead ativo
  const selectedEvents = useMemo(() => {
    if (!selectedLead) return [];
    return eventsData[selectedLead.id] || [];
  }, [selectedLead, eventsData]);

  // Extrai mensagem real de texto do WhatsApp
  const extractMessageText = (lead: Lead): string => {
    if (lead.raw && typeof lead.raw === "object") {
      const rawObj = lead.raw as Record<string, any>;
      if (rawObj.message_text && typeof rawObj.message_text === "string" && rawObj.message_text.trim()) {
        return rawObj.message_text.trim();
      }
    }
    if (lead.notes) {
      const m = lead.notes.match(/(?:WhatsApp|msg|Msg):\s*"?([^"\n\r]+)"?/i);
      if (m && m[1].trim()) return m[1].trim();
      if (!lead.notes.includes("PROPOSTA")) return lead.notes.trim();
    }
    return "Olá! Vi seu anúncio e gostaria de saber mais informações.";
  };

  // Disparo rápido de Compra (CAPI) para o Meta
  const handleSendQuickSale = async () => {
    if (!selectedLead) return;
    setSendingSale(true);
    setSaleNotice(null);
    try {
      const res = await sendEventAction({
        leadId: selectedLead.id,
        eventName: "Purchase",
        value: saleValue,
        currency: "BRL",
        contentName: selectedAd?.ad_name || selectedLead.headline || "Conversão WhatsApp",
        eventTimeIso: new Date().toISOString(),
      });
      if (res.ok) {
        setSaleNotice(`✅ Venda de R$ ${saleValue} enviada com sucesso ao Meta!`);
      } else {
        setSaleNotice(`❌ ${res.message || "Erro ao enviar conversão ao Meta."}`);
      }
    } catch (err) {
      setSaleNotice(`❌ Falha: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSendingSale(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 120px)", minHeight: "720px", gap: "12px" }}>
      {/* Barra Superior / Título */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 800 }}>💬 Central de Conversas & Leads</h1>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                padding: "3px 9px",
                borderRadius: "999px",
                background: "rgba(52, 199, 123, 0.15)",
                color: "#34c77b",
                border: "1px solid rgba(52, 199, 123, 0.3)",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <Zap size={12} />
              TEMPO REAL • WHATSAPP LIVE
            </span>
          </div>
          <p className="muted small" style={{ margin: "2px 0 0 0" }}>
            Abra o raio-x de cada conversa, confira o criativo clicado pelo lead e envie conversões em 1 clique.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {selectedLead && (
            <a
              href={`https://wa.me/${selectedLead.phone.replace(/\D/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: "none" }}
            >
              <Button size="sm" style={{ background: "#25D366", color: "#ffffff", fontWeight: 700, display: "flex", gap: "6px" }}>
                <ExternalLink size={14} />
                Abrir no WhatsApp Web
              </Button>
            </a>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowRightPanel(!showRightPanel)}
            title="Alternar Raio-X de Atribuição"
          >
            {showRightPanel ? "Ocultar Raio-X" : "Mostrar Raio-X"}
          </Button>
        </div>
      </div>

      {/* Grid Principal: 3 Colunas (Lista | Chat Visual | Raio-X de Anúncio) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: showRightPanel ? "340px 1fr 340px" : "360px 1fr",
          gap: "14px",
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* ========================================================================= */}
        {/* COLUNA 1: Lista de Conversas / Leads */}
        {/* ========================================================================= */}
        <div
          className="card"
          style={{
            display: "flex",
            flexDirection: "column",
            padding: "14px",
            margin: 0,
            overflow: "hidden",
            height: "100%",
          }}
        >
          {/* Busca e Filtro de Cliente */}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "12px" }}>
            <div style={{ position: "relative" }}>
              <Search
                size={15}
                style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }}
              />
              <input
                type="text"
                placeholder="Buscar conversa ou telefone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: "100%",
                  padding: "7px 10px 7px 32px",
                  borderRadius: "8px",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                  fontSize: "12px",
                }}
              />
            </div>

            {clients.length > 1 && (
              <select
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                style={{
                  width: "100%",
                  padding: "6px 10px",
                  borderRadius: "8px",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                  fontSize: "12px",
                }}
              >
                <option value="">Todos os Clientes</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}

            {/* Pílulas de filtro rápido */}
            <div style={{ display: "flex", gap: "4px", overflowX: "auto", paddingBottom: "2px" }}>
              {[
                { id: "todos", label: "Todos", count: initialLeads.length },
                {
                  id: "com-anuncio",
                  label: "🎯 Anúncio",
                  count: initialLeads.filter((l) => l.ctwa_clid || l.source_id).length,
                },
                {
                  id: "com-venda",
                  label: "💰 Venda",
                  count: initialLeads.filter((l) => (eventsData[l.id] || []).some((e) => e.event_name === "Purchase")).length,
                },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id as any)}
                  style={{
                    padding: "4px 8px",
                    borderRadius: "6px",
                    border: "none",
                    background: activeTab === tab.id ? "var(--primary)" : "rgba(255, 255, 255, 0.05)",
                    color: activeTab === tab.id ? "#ffffff" : "var(--text-muted)",
                    fontSize: "11px",
                    fontWeight: 600,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <span>{tab.label}</span>
                  <span style={{ opacity: 0.7, fontSize: "10px" }}>({tab.count})</span>
                </button>
              ))}
            </div>
          </div>

          {/* Lista de Contatos com Scroll */}
          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px", paddingRight: "4px" }}>
            {filteredLeads.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 10px", color: "var(--text-muted)", fontSize: "12px" }}>
                Nenhuma conversa encontrada.
              </div>
            ) : (
              filteredLeads.map((lead) => {
                const isSelected = selectedLead?.id === lead.id;
                const leadEvents = eventsData[lead.id] || [];
                const purchase = leadEvents.find((e) => e.event_name === "Purchase");
                const hasCtwa = Boolean(lead.ctwa_clid);
                const messageSnippet = extractMessageText(lead);
                const initials = (lead.name || "Sem Nome")
                  .split(" ")
                  .map((p) => p[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase();

                return (
                  <div
                    key={lead.id}
                    onClick={() => setSelectedLeadId(lead.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "10px 12px",
                      borderRadius: "10px",
                      cursor: "pointer",
                      background: isSelected
                        ? "linear-gradient(90deg, rgba(123, 57, 252, 0.18), rgba(52, 199, 123, 0.08))"
                        : "var(--surface)",
                      border: isSelected ? "1px solid rgba(123, 57, 252, 0.5)" : "1px solid transparent",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {/* Avatar */}
                    <div
                      style={{
                        width: "40px",
                        height: "40px",
                        borderRadius: "50%",
                        background: isSelected ? "linear-gradient(135deg, #7b39fc, #34c77b)" : "rgba(255, 255, 255, 0.08)",
                        color: "#ffffff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 700,
                        fontSize: "13px",
                        flexShrink: 0,
                      }}
                    >
                      {initials}
                    </div>

                    {/* Informações centrais */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "2px" }}>
                        <span style={{ fontWeight: 700, fontSize: "13px", color: isSelected ? "#ffffff" : "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {lead.name || "Sem Nome"}
                        </span>
                        <span style={{ fontSize: "10px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                          {formatDateTime(lead.first_seen_at).split(" ")[0]}
                        </span>
                      </div>

                      <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>
                        {formatPhone(lead.phone)}
                      </div>

                      <div style={{ fontSize: "11px", color: "#a5b4fc", opacity: 0.85, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {messageSnippet}
                      </div>

                      {/* Tags */}
                      <div style={{ display: "flex", gap: "4px", marginTop: "4px", flexWrap: "wrap" }}>
                        {hasCtwa ? (
                          <span style={{ fontSize: "9px", padding: "1px 5px", borderRadius: "4px", background: "rgba(52, 199, 123, 0.15)", color: "#34c77b", fontWeight: 700 }}>
                            CTWA ✓
                          </span>
                        ) : (
                          <span style={{ fontSize: "9px", padding: "1px 5px", borderRadius: "4px", background: "rgba(255, 255, 255, 0.05)", color: "var(--text-muted)" }}>
                            Orgânico
                          </span>
                        )}

                        {purchase && (
                          <span style={{ fontSize: "9px", padding: "1px 5px", borderRadius: "4px", background: "rgba(255, 215, 0, 0.15)", color: "#ffd700", fontWeight: 700 }}>
                            {formatMoney(purchase.value, purchase.currency || "BRL")}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* COLUNA 2: Janela do Chat Estilo WhatsApp Web */}
        {/* ========================================================================= */}
        <div
          className="card"
          style={{
            display: "flex",
            flexDirection: "column",
            padding: 0,
            margin: 0,
            overflow: "hidden",
            height: "100%",
            background: "#0c0a17",
            border: "1px solid var(--border)",
          }}
        >
          {selectedLead ? (
            <>
              {/* Topo do Chat */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "14px 18px",
                  background: "var(--surface)",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <div
                    style={{
                      width: "44px",
                      height: "44px",
                      borderRadius: "50%",
                      background: "linear-gradient(135deg, #7b39fc, #34c77b)",
                      color: "#ffffff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                      fontSize: "15px",
                    }}
                  >
                    {(selectedLead.name || "L")[0].toUpperCase()}
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <strong style={{ fontSize: "15px", color: "#ffffff" }}>
                        {selectedLead.name || "Sem Nome"}
                      </strong>
                      <span
                        style={{
                          fontSize: "10px",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          background: "rgba(52, 199, 123, 0.15)",
                          color: "#34c77b",
                          fontWeight: 700,
                        }}
                      >
                        {selectedLead.origin === "manual" ? "Baileys / WhatsApp" : "Leona"}
                      </span>
                    </div>
                    <div className="muted small" style={{ fontSize: "11px", marginTop: "2px" }}>
                      +{selectedLead.phone}
                      {selectedLead.city ? ` · ${selectedLead.city}` : ""}
                      {selectedLead.state ? `/${selectedLead.state}` : ""}
                      {` · Cliente: ${clientNameMap[selectedLead.client_id] || "—"}`}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/leads/${selectedLead.id}`}>
                      Ver Detalhes Lead
                      <ChevronRight size={14} />
                    </Link>
                  </Button>
                </div>
              </div>

              {/* Corpo de Mensagens (Fundo de WhatsApp) */}
              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: "20px 24px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                  background: "radial-gradient(ellipse at center, rgba(123, 57, 252, 0.05) 0%, rgba(12, 10, 23, 0.98) 100%)",
                }}
              >
                {/* 1. Balão do Anúncio Meta Click-to-WhatsApp (Se existir) */}
                {(selectedLead.source_id || selectedLead.ctwa_clid || selectedLead.headline || selectedAd) && (
                  <div
                    style={{
                      maxWidth: "460px",
                      borderRadius: "12px",
                      background: "rgba(26, 21, 40, 0.95)",
                      border: "1px solid rgba(123, 57, 252, 0.35)",
                      overflow: "hidden",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                      alignSelf: "flex-start",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 12px", background: "rgba(123, 57, 252, 0.15)", borderBottom: "1px solid rgba(123, 57, 252, 0.2)", fontSize: "11px", fontWeight: 700, color: "#b394ff" }}>
                      <Flame size={14} />
                      <span>Anúncio Click-to-WhatsApp Clicado no Instagram/Facebook</span>
                    </div>

                    <div style={{ display: "flex", gap: "12px", padding: "12px" }}>
                      {(selectedLead.thumbnail_url || selectedAd?.thumbnail_url) && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={selectedLead.thumbnail_url || selectedAd?.thumbnail_url}
                          alt="Criativo"
                          style={{ width: "70px", height: "70px", borderRadius: "8px", objectFit: "cover", flexShrink: 0 }}
                        />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: "13px", color: "#ffffff", marginBottom: "4px" }}>
                          {selectedLead.headline || selectedAd?.creative_title || selectedAd?.ad_name || "Criativo Meta Ads"}
                        </div>
                        <div style={{ fontSize: "11px", color: "var(--text-muted)", lineHeight: "1.4", maxHeight: "40px", overflow: "hidden" }}>
                          {selectedLead.ad_body || selectedAd?.creative_body || "Anúncio veiculado no Instagram com destino ao WhatsApp."}
                        </div>
                        {selectedAd?.campaign_name && (
                          <div style={{ fontSize: "10px", color: "#34c77b", fontWeight: 600, marginTop: "6px" }}>
                            Campanha: {selectedAd.campaign_name}
                          </div>
                        )}
                      </div>
                    </div>

                    {selectedLead.ctwa_clid && (
                      <div style={{ padding: "6px 12px", background: "rgba(52, 199, 123, 0.08)", borderTop: "1px solid rgba(52, 199, 123, 0.2)", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "10px", color: "#34c77b" }}>
                        <span>Rastreamento ctwa_clid capturado ✓</span>
                        <span className="mono" style={{ opacity: 0.8 }}>#{selectedLead.ctwa_clid.slice(0, 16)}...</span>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. Lista de Mensagens da Conversa (Histórico Completo WhatsApp) */}
                {(() => {
                  const rawObj = (selectedLead.raw && typeof selectedLead.raw === "object") ? (selectedLead.raw as Record<string, any>) : {};
                  const messagesList: Array<{ text: string; at: string; fromMe?: boolean }> = Array.isArray(rawObj.messages) && rawObj.messages.length > 0
                    ? rawObj.messages
                    : [{ text: extractMessageText(selectedLead), at: selectedLead.first_seen_at, fromMe: false }];

                  return messagesList.map((m, idx) => {
                    const isFromMe = Boolean(m.fromMe);
                    const timeStr = m.at ? formatDateTime(m.at).split(" ")[1] || "12:00" : "12:00";

                    return (
                      <div
                        key={idx}
                        style={{
                          maxWidth: "520px",
                          borderRadius: isFromMe ? "14px 14px 2px 14px" : "14px 14px 14px 2px",
                          background: isFromMe
                            ? "linear-gradient(135deg, #005c4b 0%, #007a63 100%)"
                            : "linear-gradient(135deg, rgba(32, 44, 51, 0.95) 0%, rgba(26, 36, 42, 0.95) 100%)",
                          border: isFromMe
                            ? "1px solid rgba(52, 199, 123, 0.3)"
                            : "1px solid rgba(255, 255, 255, 0.1)",
                          padding: "10px 14px",
                          color: "#ffffff",
                          fontSize: "13px",
                          lineHeight: "1.5",
                          alignSelf: isFromMe ? "flex-end" : "flex-start",
                          boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
                          display: "flex",
                          flexDirection: "column",
                          gap: "4px",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
                          <span style={{ fontWeight: 700, color: isFromMe ? "#34c77b" : "#60a5fa", fontSize: "11px" }}>
                            {isFromMe ? "Você (Atendente)" : (selectedLead.name || "Lead")}
                          </span>
                          {selectedLead.ctwa_clid && !isFromMe && idx === 0 && (
                            <span style={{ fontSize: "9px", padding: "1px 6px", borderRadius: "4px", background: "rgba(52, 199, 123, 0.2)", color: "#34c77b", fontWeight: 700 }}>
                              CTWA Meta ✓
                            </span>
                          )}
                        </div>

                        <div style={{ wordBreak: "break-word", whiteSpace: "pre-wrap" }}>
                          {m.text}
                        </div>

                        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "4px", fontSize: "10px", color: isFromMe ? "#a7f3d0" : "#94a3b8", marginTop: "2px" }}>
                          <span>{timeStr}</span>
                          <CheckCheck size={13} style={{ color: isFromMe ? "#38bdf8" : "#94a3b8" }} />
                        </div>
                      </div>
                    );
                  });
                })()}

                {/* 3. Balões de Linha do Tempo / Eventos CAPI */}
                {selectedEvents.map((ev) => (
                  <div
                    key={ev.id}
                    style={{
                      maxWidth: "460px",
                      borderRadius: "10px",
                      background:
                        ev.event_name === "Purchase"
                          ? "linear-gradient(90deg, rgba(255, 215, 0, 0.15), rgba(52, 199, 123, 0.15))"
                          : "rgba(56, 189, 248, 0.12)",
                      border:
                        ev.event_name === "Purchase"
                          ? "1px solid rgba(255, 215, 0, 0.35)"
                          : "1px solid rgba(56, 189, 248, 0.3)",
                      padding: "10px 14px",
                      alignSelf: "center",
                      textAlign: "center",
                      fontSize: "12px",
                      color: "#ffffff",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", fontWeight: 700 }}>
                      <BadgeCheck size={15} style={{ color: ev.event_name === "Purchase" ? "#ffd700" : "#38bdf8" }} />
                      <span>
                        {ev.event_name === "Purchase"
                          ? `🎉 COMPRA APROVADA: ${formatMoney(ev.value, ev.currency || "BRL")}`
                          : `Evento ${ev.event_name} enviado ao Meta`}
                      </span>
                    </div>
                    <div className="muted small" style={{ fontSize: "10px", marginTop: "2px" }}>
                      Atribuído ao anúncio · {formatDateTime(ev.created_at)}
                    </div>
                  </div>
                ))}
              </div>

              {/* Rodapé de Ações do Chat */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "14px 20px",
                  background: "var(--surface)",
                  borderTop: "1px solid var(--border)",
                  gap: "12px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <a
                    href={`https://wa.me/${selectedLead.phone.replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ textDecoration: "none" }}
                  >
                    <Button
                      size="sm"
                      style={{
                        background: "#25D366",
                        color: "#ffffff",
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <MessageCircle size={15} />
                      Conversar no WhatsApp Web
                    </Button>
                  </a>
                </div>

                {/* Formulário Rápido de Compra */}
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Marcar Venda: R$</span>
                  <input
                    type="text"
                    value={saleValue}
                    onChange={(e) => setSaleValue(e.target.value)}
                    placeholder="197,00"
                    style={{
                      width: "80px",
                      padding: "5px 8px",
                      borderRadius: "6px",
                      background: "var(--background)",
                      border: "1px solid var(--border)",
                      color: "#ffd700",
                      fontWeight: 700,
                      fontSize: "12px",
                      textAlign: "center",
                    }}
                  />
                  <Button
                    size="sm"
                    onClick={handleSendQuickSale}
                    disabled={sendingSale}
                    style={{
                      background: "linear-gradient(90deg, #ffd700, #ffaa00)",
                      color: "#000000",
                      fontWeight: 800,
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    {sendingSale ? <Loader2 size={13} className="animate-spin" /> : <DollarSign size={13} />}
                    Enviar CAPI
                  </Button>
                </div>
              </div>

              {saleNotice && (
                <div
                  style={{
                    padding: "8px 16px",
                    fontSize: "12px",
                    background: saleNotice.startsWith("✅") ? "rgba(52, 199, 123, 0.15)" : "rgba(239, 68, 68, 0.15)",
                    borderTop: "1px solid var(--border)",
                    color: saleNotice.startsWith("✅") ? "#34c77b" : "#ef4444",
                    textAlign: "center",
                  }}
                >
                  {saleNotice}
                </div>
              )}
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", gap: "10px" }}>
              <MessageSquare size={40} style={{ opacity: 0.4 }} />
              <div>Selecione um lead na lista à esquerda para abrir a conversa.</div>
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* COLUNA 3: Raio-X de Atribuição Meta Ads */}
        {/* ========================================================================= */}
        {showRightPanel && (
          <div
            className="card"
            style={{
              display: "flex",
              flexDirection: "column",
              padding: "16px",
              margin: 0,
              overflowY: "auto",
              height: "100%",
              gap: "16px",
            }}
          >
            {selectedLead ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", borderBottom: "1px solid var(--border)", paddingBottom: "10px" }}>
                  <TrendingUp size={16} style={{ color: "#7b39fc" }} />
                  <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700 }}>Raio-X de Atribuição Meta Ads</h3>
                </div>

                {/* 1. Criativo / Miniatura do Anúncio */}
                <div>
                  <label style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", marginBottom: "6px", fontWeight: 600 }}>
                    Criativo do Anúncio Clicado
                  </label>
                  {(selectedLead.thumbnail_url || selectedAd?.thumbnail_url) ? (
                    <div style={{ position: "relative", borderRadius: "10px", overflow: "hidden", border: "1px solid var(--border)" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={selectedLead.thumbnail_url || selectedAd?.thumbnail_url}
                        alt="Criativo Meta"
                        style={{ width: "100%", maxHeight: "150px", objectFit: "cover", display: "block" }}
                      />
                      <div style={{ padding: "8px 10px", background: "rgba(15, 12, 25, 0.9)", fontSize: "11px", fontWeight: 600 }}>
                        {selectedLead.headline || selectedAd?.creative_title || "Criativo Meta Ads"}
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: "16px", borderRadius: "8px", background: "var(--surface)", border: "1px solid var(--border)", textAlign: "center", fontSize: "11px", color: "var(--text-muted)" }}>
                      Sem miniatura registrada
                    </div>
                  )}
                </div>

                {/* 2. Dados da Campanha e Conjunto */}
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "12px" }}>
                  <div style={{ padding: "10px", borderRadius: "8px", background: "var(--surface)", border: "1px solid var(--border)" }}>
                    <div style={{ fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>Campanha Meta</div>
                    <div style={{ fontWeight: 700, color: "#ffffff", marginTop: "2px" }}>
                      {selectedAd?.campaign_name || "Campanha Click-to-WhatsApp"}
                    </div>
                  </div>

                  <div style={{ padding: "10px", borderRadius: "8px", background: "var(--surface)", border: "1px solid var(--border)" }}>
                    <div style={{ fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>Conjunto de Anúncios</div>
                    <div style={{ fontWeight: 600, color: "var(--text)", marginTop: "2px" }}>
                      {selectedAd?.adset_name || "Público Alvo / Conjunto"}
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <div style={{ padding: "8px 10px", borderRadius: "8px", background: "var(--surface)", border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>Gasto (Spend)</div>
                      <div style={{ fontWeight: 700, color: "#34c77b", fontSize: "13px", marginTop: "2px" }}>
                        {formatMoney(selectedAd?.spend ?? 0, "BRL")}
                      </div>
                    </div>
                    <div style={{ padding: "8px 10px", borderRadius: "8px", background: "var(--surface)", border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>Cliques / Conversas</div>
                      <div style={{ fontWeight: 700, color: "#38bdf8", fontSize: "13px", marginTop: "2px" }}>
                        {selectedAd?.conversations ?? selectedAd?.clicks ?? "—"}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. Parâmetros de Rastreio (ctwa_clid e source_id) */}
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{ padding: "10px", borderRadius: "8px", background: "var(--surface)", border: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                      <span style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 700 }}>CTWA_CLID (CHAVE DO META)</span>
                      {selectedLead.ctwa_clid && (
                        <button
                          type="button"
                          onClick={() => copyToClipboard(selectedLead.ctwa_clid!, "ctwa")}
                          style={{ background: "none", border: "none", color: "#34c77b", cursor: "pointer", fontSize: "10px", display: "flex", alignItems: "center", gap: "2px" }}
                        >
                          {copiedKey === "ctwa" ? <Check size={11} /> : <Copy size={11} />}
                          {copiedKey === "ctwa" ? "Copiado" : "Copiar"}
                        </button>
                      )}
                    </div>
                    <div className="mono" style={{ fontSize: "11px", color: selectedLead.ctwa_clid ? "#34c77b" : "var(--text-muted)", wordBreak: "break-all" }}>
                      {selectedLead.ctwa_clid || "Não capturado (orgânico)"}
                    </div>
                  </div>

                  {selectedLead.source_id && (
                    <div style={{ padding: "10px", borderRadius: "8px", background: "var(--surface)", border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 700, marginBottom: "4px" }}>ID DO ANÚNCIO (AD_ID)</div>
                      <div className="mono" style={{ fontSize: "11px", color: "#b394ff" }}>
                        {selectedLead.source_id}
                      </div>
                    </div>
                  )}
                </div>

                {/* 4. Resumo de Conversões CAPI */}
                <div>
                  <div style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 700, marginBottom: "6px" }}>
                    Histórico de Conversões CAPI ({selectedEvents.length})
                  </div>
                  {selectedEvents.length === 0 ? (
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", padding: "10px", background: "var(--surface)", borderRadius: "8px", textAlign: "center" }}>
                      Nenhuma venda registrada ainda. Use o botão acima para enviar.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      {selectedEvents.map((ev) => (
                        <div key={ev.id} style={{ padding: "8px 10px", borderRadius: "6px", background: "var(--surface)", border: "1px solid var(--border)", fontSize: "11px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <div>
                            <strong style={{ color: ev.event_name === "Purchase" ? "#ffd700" : "#ffffff" }}>
                              {ev.event_name}
                            </strong>
                            <div className="muted small" style={{ fontSize: "10px" }}>{formatDateTime(ev.created_at)}</div>
                          </div>
                          <span style={{ fontWeight: 700, color: "#34c77b" }}>
                            {ev.value ? formatMoney(ev.value, ev.currency || "BRL") : "✓"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div style={{ textAlign: "center", padding: "40px 10px", color: "var(--text-muted)", fontSize: "12px" }}>
                Selecione um lead para ver o raio-x de anúncio.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
