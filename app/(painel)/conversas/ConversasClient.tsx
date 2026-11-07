"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  BadgeCheck,
  Check,
  CheckCheck,
  ChevronRight,
  Clock,
  Copy,
  DollarSign,
  ExternalLink,
  Flame,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  MessageSquare,
  Mic,
  Phone,
  RefreshCw,
  Search,
  Send,
  Tag,
  TrendingUp,
  User,
  Volume2,
  X,
  Zap,
} from "lucide-react";
import { sendEventAction, sendWhatsAppMessageAction } from "@/app/actions";
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

type TabFilter = "todos" | "com-anuncio" | "com-venda" | "aguardando";

function getInitials(name: string | null): string {
  return (name || "?")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function getAvatarGradient(name: string | null): string {
  const colors = [
    "linear-gradient(135deg,#7b39fc,#a855f7)",
    "linear-gradient(135deg,#2563eb,#7b39fc)",
    "linear-gradient(135deg,#059669,#34c77b)",
    "linear-gradient(135deg,#dc2626,#f97316)",
    "linear-gradient(135deg,#0891b2,#38bdf8)",
    "linear-gradient(135deg,#7c3aed,#ec4899)",
    "linear-gradient(135deg,#b45309,#fbbf24)",
  ];
  const idx = (name || "?").charCodeAt(0) % colors.length;
  return colors[idx];
}

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

// Detecta o tipo de mensagem para o ícone da lista
function getMessageTypeIcon(lead: Lead): "audio" | "image" | "text" {
  const raw = lead.raw as Record<string, any> | null;
  if (!raw) return "text";
  const msgs: any[] = Array.isArray(raw.messages) ? raw.messages : [];
  const last = msgs[msgs.length - 1];
  if (!last) return "text";
  if (last.type === "audio" || last.isAudio) return "audio";
  if (last.type === "image" || last.isImage) return "image";
  return "text";
}

function extractMessageText(lead: Lead): string {
  const raw = lead.raw as Record<string, any> | null;
  if (raw?.message_text && typeof raw.message_text === "string" && raw.message_text.trim()) {
    return raw.message_text.trim();
  }
  if (lead.notes) {
    const m = lead.notes.match(/(?:WhatsApp|msg|Msg):\s*"?([^"\n\r]+)"?/i);
    if (m && m[1].trim()) return m[1].trim();
    if (!lead.notes.includes("PROPOSTA")) return lead.notes.trim();
  }
  return "Olá! Gostaria de saber mais informações.";
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
  const [currentLeads, setCurrentLeads] = useState<Lead[]>(initialLeads);
  const [currentAdsData, setCurrentAdsData] = useState<Record<string, any>>(adsData);
  const [currentEventsData, setCurrentEventsData] = useState<Record<string, any[]>>(eventsData);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(initialSelectedLeadId);
  const [clientFilter, setClientFilter] = useState<string>(initialClientId);
  const [searchQuery, setSearchQuery] = useState<string>(initialSearchQuery);
  const [activeTab, setActiveTab] = useState<TabFilter>("todos");
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [saleValue, setSaleValue] = useState<string>("197,00");
  const [sendingSale, setSendingSale] = useState(false);
  const [saleNotice, setSaleNotice] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Live polling
  useEffect(() => {
    let active = true;
    const fetchLive = async () => {
      try {
        const params = new URLSearchParams();
        if (clientFilter) params.set("cliente", clientFilter);
        if (searchQuery) params.set("q", searchQuery);
        const res = await fetch(`/api/conversas/live?${params.toString()}`, { cache: "no-store" });
        if (res.ok && active) {
          const json = await res.json();
          if (json.ok && Array.isArray(json.leads)) {
            setCurrentLeads(json.leads);
            if (json.adsData) setCurrentAdsData(json.adsData);
            if (json.eventsData) setCurrentEventsData(json.eventsData);
            setLastUpdated(new Date());
          }
        }
      } catch {
        // silencioso
      }
    };
    const interval = setInterval(fetchLive, 4000);
    return () => { active = false; clearInterval(interval); };
  }, [clientFilter, searchQuery]);

  // Auto scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selectedLeadId, currentLeads]);

  const copyToClipboard = useCallback((text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }, []);

  const filteredLeads = useMemo(() => {
    return currentLeads.filter((lead) => {
      if (clientFilter && lead.client_id !== clientFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const nameMatch = lead.name?.toLowerCase().includes(q);
        const phoneMatch = lead.phone.includes(q);
        const adMatch = lead.source_id?.includes(q);
        const notesMatch = lead.notes?.toLowerCase().includes(q);
        if (!nameMatch && !phoneMatch && !adMatch && !notesMatch) return false;
      }
      const hasPurchased = (currentEventsData[lead.id] || []).some((e) => e.event_name === "Purchase");
      const hasAd = Boolean(lead.ctwa_clid || lead.source_id);
      if (activeTab === "com-anuncio" && !hasAd) return false;
      if (activeTab === "com-venda" && !hasPurchased) return false;
      if (activeTab === "aguardando" && hasPurchased) return false;
      return true;
    });
  }, [currentLeads, clientFilter, searchQuery, activeTab, currentEventsData]);

  const selectedLead = useMemo(() => {
    if (!selectedLeadId) return filteredLeads[0] || currentLeads[0] || null;
    return currentLeads.find((l) => l.id === selectedLeadId) || filteredLeads[0] || null;
  }, [selectedLeadId, currentLeads, filteredLeads]);

  const selectedAd = useMemo(() => {
    if (!selectedLead || !selectedLead.source_id) return null;
    return currentAdsData[`${selectedLead.client_id}:${selectedLead.source_id}`] || null;
  }, [selectedLead, currentAdsData]);

  const selectedEvents = useMemo(() => {
    if (!selectedLead) return [];
    return currentEventsData[selectedLead.id] || [];
  }, [selectedLead, currentEventsData]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedLead || !replyText.trim() || sendingReply) return;
    setSendingReply(true);
    setReplyError(null);
    const msgToSend = replyText.trim();
    try {
      const res = await sendWhatsAppMessageAction(selectedLead.client_id, selectedLead.phone, msgToSend);
      if (res.ok) {
        setReplyText("");
        setCurrentLeads((prev) =>
          prev.map((l) => {
            if (l.id !== selectedLead.id) return l;
            const rawObj = (l.raw && typeof l.raw === "object") ? (l.raw as Record<string, any>) : {};
            const existingMessages = Array.isArray(rawObj.messages) ? rawObj.messages : [];
            return {
              ...l,
              raw: {
                ...rawObj,
                messages: [
                  ...existingMessages,
                  { text: msgToSend, at: new Date().toISOString(), fromMe: true },
                ],
              },
            };
          })
        );
      } else {
        setReplyError(res.error || "Não foi possível enviar a mensagem. Verifique a conexão do WhatsApp.");
      }
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : String(err));
    } finally {
      setSendingReply(false);
    }
  };

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

  // ============================================================
  // STYLES helpers
  // ============================================================
  const css = {
    root: {
      display: "flex",
      flexDirection: "column" as const,
      height: "calc(100vh - 72px)",
      minHeight: "680px",
      background: "#080714",
      color: "#e2e0f0",
      fontFamily: "'Inter', system-ui, sans-serif",
      overflow: "hidden",
    } as React.CSSProperties,
    grid: {
      display: "grid",
      gridTemplateColumns: showRightPanel ? "300px 1fr 300px" : "300px 1fr",
      gap: 0,
      flex: 1,
      minHeight: 0,
      overflow: "hidden",
    } as React.CSSProperties,
  };

  const PURPLE = "#7b39fc";
  const DARK_BG = "#0d0a1e";
  const SURFACE = "#15112a";
  const BORDER = "rgba(255,255,255,0.08)";
  const TEXT_MUTED = "#6b6a85";
  const GREEN = "#25D366";

  // Tab counts
  const tabCounts = useMemo(() => ({
    todos: currentLeads.length,
    "com-anuncio": currentLeads.filter((l) => l.ctwa_clid || l.source_id).length,
    "com-venda": currentLeads.filter((l) => (currentEventsData[l.id] || []).some((e) => e.event_name === "Purchase")).length,
    aguardando: currentLeads.filter((l) => !(currentEventsData[l.id] || []).some((e) => e.event_name === "Purchase")).length,
  }), [currentLeads, currentEventsData]);

  const tabs: { id: TabFilter; label: string }[] = [
    { id: "todos", label: "Todos" },
    { id: "aguardando", label: "Aguardando" },
    { id: "com-anuncio", label: "🎯 Anúncio" },
    { id: "com-venda", label: "💰 Venda" },
  ];

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div style={css.root}>
      {/* ══════════════ HEADER BAR ══════════════ */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 18px",
          background: SURFACE,
          borderBottom: `1px solid ${BORDER}`,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <MessageCircle size={18} style={{ color: PURPLE }} />
          <span style={{ fontWeight: 800, fontSize: 15, color: "#fff" }}>Central de Conversas</span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 999,
              background: "rgba(52, 199, 123, 0.15)",
              color: "#34c77b",
              border: "1px solid rgba(52, 199, 123, 0.3)",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Zap size={9} />
            LIVE
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, color: TEXT_MUTED }}>
            {lastUpdated.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
          <button
            type="button"
            onClick={() => setShowRightPanel((v) => !v)}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              border: `1px solid ${BORDER}`,
              background: "transparent",
              color: TEXT_MUTED,
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            {showRightPanel ? "Ocultar Raio-X" : "Mostrar Raio-X"}
          </button>
        </div>
      </div>

      {/* ══════════════ MAIN 3-COLUMN GRID ══════════════ */}
      <div style={css.grid}>

        {/* ================================================================ */}
        {/* COLUNA 1: LISTA DE CONVERSAS                                     */}
        {/* ================================================================ */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            borderRight: `1px solid ${BORDER}`,
            background: DARK_BG,
            overflow: "hidden",
          }}
        >
          {/* Search */}
          <div style={{ padding: "10px 12px", borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
            <div style={{ position: "relative", marginBottom: 8 }}>
              <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: TEXT_MUTED }} />
              <input
                type="text"
                placeholder="Buscar conversa..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: "100%",
                  padding: "7px 10px 7px 30px",
                  borderRadius: 8,
                  background: SURFACE,
                  border: `1px solid ${BORDER}`,
                  color: "#e2e0f0",
                  fontSize: 12,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* Filter Tabs */}
            <div style={{ display: "flex", gap: 4, overflowX: "auto" }}>
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  style={{
                    padding: "3px 8px",
                    borderRadius: 6,
                    border: "none",
                    background: activeTab === t.id ? PURPLE : "rgba(255,255,255,0.05)",
                    color: activeTab === t.id ? "#fff" : TEXT_MUTED,
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
                    flexShrink: 0,
                  }}
                >
                  {t.label}
                  <span style={{ opacity: 0.7, fontSize: 9 }}>({tabCounts[t.id]})</span>
                </button>
              ))}
            </div>
          </div>

          {/* Client filter */}
          {clients.length > 1 && (
            <div style={{ padding: "6px 12px", borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
              <select
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                style={{
                  width: "100%",
                  padding: "5px 8px",
                  borderRadius: 6,
                  background: SURFACE,
                  border: `1px solid ${BORDER}`,
                  color: "#e2e0f0",
                  fontSize: 11,
                }}
              >
                <option value="">Todos os Clientes</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Contact List */}
          <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
            {filteredLeads.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 16px", color: TEXT_MUTED, fontSize: 12 }}>
                Nenhuma conversa encontrada.
              </div>
            ) : (
              filteredLeads.map((lead) => {
                const isSelected = selectedLead?.id === lead.id;
                const leadEvents = currentEventsData[lead.id] || [];
                const purchase = leadEvents.find((e) => e.event_name === "Purchase");
                const hasCtwa = Boolean(lead.ctwa_clid);
                const hasAd = Boolean(lead.ctwa_clid || lead.source_id);
                const msgType = getMessageTypeIcon(lead);
                const snippet = extractMessageText(lead);
                const rawObj = (lead.raw && typeof lead.raw === "object") ? (lead.raw as Record<string, any>) : {};
                const msgs = Array.isArray(rawObj.messages) ? rawObj.messages : [];
                const lastMsg = msgs[msgs.length - 1];
                const lastTime = lastMsg?.at || lead.first_seen_at;

                return (
                  <div
                    key={lead.id}
                    onClick={() => { setSelectedLeadId(lead.id); setSaleNotice(null); }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 12px",
                      cursor: "pointer",
                      background: isSelected ? "rgba(123,57,252,0.14)" : "transparent",
                      borderLeft: isSelected ? `3px solid ${PURPLE}` : "3px solid transparent",
                      transition: "all 0.1s",
                    }}
                  >
                    {/* Avatar */}
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: "50%",
                        background: isSelected ? `linear-gradient(135deg, ${PURPLE}, #34c77b)` : getAvatarGradient(lead.name),
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 800,
                        fontSize: 13,
                        flexShrink: 0,
                        position: "relative",
                      }}
                    >
                      {getInitials(lead.name)}
                      {/* Online dot */}
                      {isSelected && (
                        <span style={{
                          position: "absolute",
                          bottom: 1,
                          right: 1,
                          width: 9,
                          height: 9,
                          borderRadius: "50%",
                          background: "#34c77b",
                          border: "2px solid #0d0a1e",
                        }} />
                      )}
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 1 }}>
                        <span style={{ fontWeight: 700, fontSize: 12, color: isSelected ? "#fff" : "#ccc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>
                          {lead.name || "Sem Nome"}
                        </span>
                        <span style={{ fontSize: 10, color: TEXT_MUTED, flexShrink: 0 }}>
                          {timeAgo(lastTime)}
                        </span>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
                        {msgType === "audio" && <Mic size={10} style={{ color: TEXT_MUTED, flexShrink: 0 }} />}
                        {msgType === "image" && <ImageIcon size={10} style={{ color: TEXT_MUTED, flexShrink: 0 }} />}
                        <span style={{ fontSize: 11, color: TEXT_MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {msgType === "audio" ? "Áudio" : msgType === "image" ? "Imagem" : snippet}
                        </span>
                      </div>

                      {/* Badges */}
                      <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                        {hasCtwa && (
                          <span style={{ fontSize: 9, padding: "1px 4px", borderRadius: 3, background: "rgba(52,199,123,0.15)", color: "#34c77b", fontWeight: 700 }}>
                            CTWA ✓
                          </span>
                        )}
                        {!hasCtwa && hasAd && (
                          <span style={{ fontSize: 9, padding: "1px 4px", borderRadius: 3, background: "rgba(123,57,252,0.15)", color: "#b394ff", fontWeight: 700 }}>
                            AD
                          </span>
                        )}
                        {purchase ? (
                          <span style={{ fontSize: 9, padding: "1px 4px", borderRadius: 3, background: "rgba(255,215,0,0.15)", color: "#ffd700", fontWeight: 700 }}>
                            {formatMoney(purchase.value, purchase.currency || "BRL")}
                          </span>
                        ) : (
                          <span style={{ fontSize: 9, padding: "1px 4px", borderRadius: 3, background: "rgba(255,255,255,0.05)", color: TEXT_MUTED }}>
                            Sem venda
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

        {/* ================================================================ */}
        {/* COLUNA 2: CHAT CENTRAL ESTILO WHATSAPP                          */}
        {/* ================================================================ */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            background: "#0a0818",
            backgroundImage: "radial-gradient(ellipse at 20% 50%, rgba(123,57,252,0.04) 0%, transparent 60%)",
          }}
        >
          {selectedLead ? (
            <>
              {/* Chat Header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 16px",
                  background: SURFACE,
                  borderBottom: `1px solid ${BORDER}`,
                  flexShrink: 0,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: "50%",
                      background: `linear-gradient(135deg, ${PURPLE}, #34c77b)`,
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 800,
                      fontSize: 13,
                      flexShrink: 0,
                    }}
                  >
                    {getInitials(selectedLead.name)}
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <strong style={{ fontSize: 14, color: "#fff" }}>{selectedLead.name || "Sem Nome"}</strong>
                      {selectedLead.ctwa_clid && (
                        <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: "rgba(52,199,123,0.15)", color: "#34c77b", fontWeight: 700 }}>
                          CTWA ✓
                        </span>
                      )}
                      {selectedLead.source_id && !selectedLead.ctwa_clid && (
                        <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: "rgba(123,57,252,0.15)", color: "#b394ff", fontWeight: 700 }}>
                          AD
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: TEXT_MUTED, display: "flex", alignItems: "center", gap: 4 }}>
                      <Phone size={10} />
                      +{formatPhone(selectedLead.phone)}
                      {selectedLead.city && ` · ${selectedLead.city}`}
                      {selectedLead.state && `/${selectedLead.state}`}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <a
                    href={`https://wa.me/${selectedLead.phone.replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Abrir no WhatsApp Web"
                    style={{ textDecoration: "none" }}
                  >
                    <button
                      type="button"
                      style={{
                        padding: "5px 10px",
                        borderRadius: 6,
                        border: "1px solid rgba(37,211,102,0.4)",
                        background: "transparent",
                        color: GREEN,
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <ExternalLink size={12} />
                      WhatsApp Web
                    </button>
                  </a>
                  <Button asChild size="sm" variant="outline" style={{ fontSize: 11 }}>
                    <Link href={`/leads/${selectedLead.id}`}>
                      Ver Lead
                      <ChevronRight size={12} />
                    </Link>
                  </Button>
                </div>
              </div>

              {/* Messages Area */}
              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: "16px 20px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                {/* CTWA Ad Card */}
                {(selectedLead.source_id || selectedLead.ctwa_clid || selectedLead.headline || selectedAd) && (
                  <div
                    style={{
                      maxWidth: 440,
                      borderRadius: 12,
                      background: "rgba(26,21,45,0.95)",
                      border: "1px solid rgba(123,57,252,0.3)",
                      overflow: "hidden",
                      alignSelf: "flex-start",
                      boxShadow: "0 6px 24px rgba(0,0,0,0.5)",
                    }}
                  >
                    {/* Green CTWA header like Leona */}
                    <div
                      style={{
                        padding: "7px 12px",
                        background: "linear-gradient(90deg, #064e3b, #065f46)",
                        borderBottom: "1px solid rgba(52,199,123,0.3)",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <Flame size={12} style={{ color: "#34c77b" }} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#34c77b" }}>
                        Conversão | Click-to-WhatsApp
                      </span>
                      {selectedLead.ctwa_clid ? (
                        <span style={{ marginLeft: "auto", fontSize: 9, color: "#34c77b", background: "rgba(52,199,123,0.15)", padding: "1px 5px", borderRadius: 3, fontWeight: 700 }}>
                          Mesmo anúncio ✓
                        </span>
                      ) : (
                        <span style={{ marginLeft: "auto", fontSize: 9, color: "#b394ff", background: "rgba(123,57,252,0.15)", padding: "1px 5px", borderRadius: 3, fontWeight: 700 }}>
                          AD Rastreado
                        </span>
                      )}
                    </div>

                    <div style={{ display: "flex", gap: 10, padding: 10 }}>
                      {/* Ad creative thumbnail */}
                      {(selectedLead.thumbnail_url || selectedAd?.thumbnail_url) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={selectedLead.thumbnail_url || selectedAd?.thumbnail_url}
                          alt="Criativo"
                          style={{ width: 72, height: 72, borderRadius: 8, objectFit: "cover", flexShrink: 0 }}
                        />
                      ) : (
                        <div style={{ width: 72, height: 72, borderRadius: 8, background: "rgba(123,57,252,0.1)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <ImageIcon size={22} style={{ color: PURPLE, opacity: 0.5 }} />
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 12, color: "#fff", marginBottom: 3 }}>
                          {selectedLead.headline || selectedAd?.creative_title || selectedAd?.ad_name || "Anúncio Meta Ads"}
                        </div>
                        <div style={{ fontSize: 11, color: TEXT_MUTED, lineHeight: 1.4, maxHeight: 36, overflow: "hidden" }}>
                          {selectedLead.ad_body || selectedAd?.creative_body || "Anúncio veiculado no Instagram/Facebook com destino ao WhatsApp."}
                        </div>
                        {(selectedAd?.campaign_name || selectedAd?.adset_name) && (
                          <div style={{ fontSize: 10, color: "#34c77b", marginTop: 4, fontWeight: 600 }}>
                            {selectedAd.campaign_name || "Campanha Meta"}
                          </div>
                        )}
                      </div>
                    </div>

                    {selectedLead.ctwa_clid && (
                      <div
                        style={{
                          padding: "5px 10px",
                          background: "rgba(52,199,123,0.07)",
                          borderTop: "1px solid rgba(52,199,123,0.15)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          fontSize: 10,
                          color: "#34c77b",
                        }}
                      >
                        <span>ctwa_clid capturado ✓</span>
                        <span style={{ opacity: 0.7, fontFamily: "monospace" }}>
                          {selectedLead.ctwa_clid.slice(0, 20)}...
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Messages */}
                {(() => {
                  const rawObj = (selectedLead.raw && typeof selectedLead.raw === "object") ? (selectedLead.raw as Record<string, any>) : {};
                  const messagesList: Array<{ text?: string; at: string; fromMe?: boolean; type?: string; isAudio?: boolean; isImage?: boolean }> =
                    Array.isArray(rawObj.messages) && rawObj.messages.length > 0
                      ? rawObj.messages
                      : [{ text: extractMessageText(selectedLead), at: selectedLead.first_seen_at, fromMe: false }];

                  return messagesList.map((m, idx) => {
                    const isFromMe = Boolean(m.fromMe);
                    const rawAt = m.at || selectedLead.first_seen_at;
                    const dateObj = new Date(rawAt);
                    const timeStr = isNaN(dateObj.getTime()) ? "12:00" : dateObj.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                    const isAudio = m.type === "audio" || m.isAudio;
                    const isImage = m.type === "image" || m.isImage;

                    return (
                      <div
                        key={idx}
                        style={{
                          maxWidth: 500,
                          alignSelf: isFromMe ? "flex-end" : "flex-start",
                        }}
                      >
                        {/* Audio bubble */}
                        {isAudio ? (
                          <div
                            style={{
                              borderRadius: isFromMe ? "14px 14px 2px 14px" : "14px 14px 14px 2px",
                              background: isFromMe ? "linear-gradient(135deg, #005c4b, #007a63)" : "rgba(30,24,50,0.95)",
                              border: `1px solid ${isFromMe ? "rgba(52,199,123,0.3)" : BORDER}`,
                              padding: "10px 14px",
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              minWidth: 200,
                            }}
                          >
                            <div
                              style={{
                                width: 34,
                                height: 34,
                                borderRadius: "50%",
                                background: isFromMe ? "rgba(255,255,255,0.2)" : PURPLE,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                                cursor: "pointer",
                              }}
                            >
                              <Volume2 size={14} style={{ color: "#fff" }} />
                            </div>
                            {/* Waveform bars */}
                            <div style={{ display: "flex", alignItems: "center", gap: 2, flex: 1 }}>
                              {[4, 8, 12, 6, 14, 10, 7, 11, 9, 5, 13, 8, 6, 10, 4].map((h, i) => (
                                <div key={i} style={{ width: 3, height: h, borderRadius: 2, background: isFromMe ? "rgba(255,255,255,0.5)" : "rgba(123,57,252,0.6)" }} />
                              ))}
                            </div>
                            <div style={{ fontSize: 10, color: isFromMe ? "#a7f3d0" : TEXT_MUTED, flexShrink: 0 }}>
                              <Mic size={10} style={{ display: "inline", marginRight: 2 }} />
                              Áudio
                            </div>
                            <div style={{ fontSize: 10, color: isFromMe ? "#a7f3d0" : TEXT_MUTED, flexShrink: 0 }}>
                              {timeStr}
                              {isFromMe && <CheckCheck size={12} style={{ display: "inline", marginLeft: 4, color: "#38bdf8" }} />}
                            </div>
                          </div>
                        ) : isImage ? (
                          /* Image bubble */
                          <div
                            style={{
                              borderRadius: isFromMe ? "14px 14px 2px 14px" : "14px 14px 14px 2px",
                              background: isFromMe ? "linear-gradient(135deg, #005c4b, #007a63)" : "rgba(30,24,50,0.95)",
                              border: `1px solid ${isFromMe ? "rgba(52,199,123,0.3)" : BORDER}`,
                              padding: "10px 14px",
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                            }}
                          >
                            <ImageIcon size={16} style={{ color: isFromMe ? "#a7f3d0" : "#b394ff" }} />
                            <span style={{ fontSize: 12, color: isFromMe ? "#fff" : "#ccc" }}>Imagem</span>
                            <span style={{ marginLeft: "auto", fontSize: 10, color: isFromMe ? "#a7f3d0" : TEXT_MUTED }}>
                              {timeStr}
                              {isFromMe && <CheckCheck size={12} style={{ display: "inline", marginLeft: 4, color: "#38bdf8" }} />}
                            </span>
                          </div>
                        ) : (
                          /* Text bubble */
                          <div
                            style={{
                              borderRadius: isFromMe ? "14px 14px 2px 14px" : "14px 14px 14px 2px",
                              background: isFromMe
                                ? "linear-gradient(135deg, #005c4b 0%, #007a63 100%)"
                                : "rgba(26,21,45,0.95)",
                              border: `1px solid ${isFromMe ? "rgba(52,199,123,0.25)" : "rgba(255,255,255,0.08)"}`,
                              padding: "9px 13px",
                              color: "#fff",
                              fontSize: 13,
                              lineHeight: 1.5,
                              boxShadow: "0 3px 10px rgba(0,0,0,0.3)",
                            }}
                          >
                            {!isFromMe && idx === 0 && (
                              <div style={{ fontSize: 11, fontWeight: 700, color: "#7b9fff", marginBottom: 3 }}>
                                {selectedLead.name || "Lead"}
                              </div>
                            )}
                            <div style={{ wordBreak: "break-word", whiteSpace: "pre-wrap" }}>{m.text}</div>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "flex-end",
                                gap: 3,
                                marginTop: 4,
                                fontSize: 10,
                                color: isFromMe ? "#a7f3d0" : TEXT_MUTED,
                              }}
                            >
                              <span>{timeStr}</span>
                              {isFromMe && <CheckCheck size={12} style={{ color: "#38bdf8" }} />}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}

                {/* CAPI Events in chat */}
                {selectedEvents.map((ev) => (
                  <div
                    key={ev.id}
                    style={{
                      alignSelf: "center",
                      maxWidth: 360,
                      borderRadius: 10,
                      background:
                        ev.event_name === "Purchase"
                          ? "linear-gradient(90deg, rgba(255,215,0,0.1), rgba(52,199,123,0.1))"
                          : "rgba(56,189,248,0.08)",
                      border:
                        ev.event_name === "Purchase"
                          ? "1px solid rgba(255,215,0,0.3)"
                          : "1px solid rgba(56,189,248,0.25)",
                      padding: "8px 14px",
                      textAlign: "center",
                      fontSize: 12,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontWeight: 700 }}>
                      <BadgeCheck size={14} style={{ color: ev.event_name === "Purchase" ? "#ffd700" : "#38bdf8" }} />
                      <span style={{ color: ev.event_name === "Purchase" ? "#ffd700" : "#38bdf8" }}>
                        {ev.event_name === "Purchase"
                          ? `COMPRA: ${formatMoney(ev.value, ev.currency || "BRL")}`
                          : `Evento ${ev.event_name}`}
                      </span>
                    </div>
                    <div style={{ fontSize: 10, color: TEXT_MUTED, marginTop: 2 }}>
                      {formatDateTime(ev.created_at)} · Enviado ao Meta
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              {/* Input Footer */}
              <div
                style={{
                  background: SURFACE,
                  borderTop: `1px solid ${BORDER}`,
                  padding: "10px 14px",
                  flexShrink: 0,
                }}
              >
                {/* Quick CAPI sale row */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 8,
                    padding: "6px 10px",
                    borderRadius: 8,
                    background: "rgba(255,215,0,0.06)",
                    border: "1px solid rgba(255,215,0,0.15)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: TEXT_MUTED }}>
                    <DollarSign size={12} style={{ color: "#ffd700" }} />
                    <span>Marcar Venda:</span>
                    <span style={{ color: "#ffd700", fontWeight: 700 }}>R$</span>
                    <input
                      type="text"
                      value={saleValue}
                      onChange={(e) => setSaleValue(e.target.value)}
                      placeholder="197,00"
                      style={{
                        width: 65,
                        padding: "2px 6px",
                        borderRadius: 5,
                        background: "rgba(255,215,0,0.1)",
                        border: "1px solid rgba(255,215,0,0.25)",
                        color: "#ffd700",
                        fontWeight: 700,
                        fontSize: 12,
                        textAlign: "center",
                        outline: "none",
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleSendQuickSale}
                    disabled={sendingSale}
                    style={{
                      padding: "4px 12px",
                      borderRadius: 6,
                      border: "none",
                      background: "linear-gradient(90deg, #ffd700, #ffaa00)",
                      color: "#000",
                      fontWeight: 800,
                      fontSize: 11,
                      cursor: sendingSale ? "not-allowed" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      opacity: sendingSale ? 0.7 : 1,
                    }}
                  >
                    {sendingSale ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                    Enviar CAPI
                  </button>
                </div>

                {saleNotice && (
                  <div
                    style={{
                      marginBottom: 8,
                      padding: "5px 10px",
                      borderRadius: 6,
                      background: saleNotice.startsWith("✅") ? "rgba(52,199,123,0.1)" : "rgba(239,68,68,0.1)",
                      border: `1px solid ${saleNotice.startsWith("✅") ? "rgba(52,199,123,0.3)" : "rgba(239,68,68,0.3)"}`,
                      fontSize: 11,
                      color: saleNotice.startsWith("✅") ? "#34c77b" : "#ef4444",
                    }}
                  >
                    {saleNotice}
                  </div>
                )}

                {/* Message input */}
                <form onSubmit={handleSendMessage} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    ref={inputRef}
                    type="text"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder={`Responder para ${selectedLead.name || selectedLead.phone}...`}
                    disabled={sendingReply}
                    style={{
                      flex: 1,
                      padding: "9px 14px",
                      borderRadius: 20,
                      background: "rgba(255,255,255,0.05)",
                      border: `1px solid ${BORDER}`,
                      color: "#fff",
                      fontSize: 13,
                      outline: "none",
                    }}
                  />
                  <button
                    type="submit"
                    disabled={sendingReply || !replyText.trim()}
                    title="Enviar mensagem via WhatsApp"
                    style={{
                      borderRadius: "50%",
                      width: 38,
                      height: 38,
                      padding: 0,
                      background: replyText.trim() ? GREEN : "rgba(255,255,255,0.08)",
                      border: "none",
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      cursor: replyText.trim() ? "pointer" : "default",
                      transition: "background 0.2s",
                    }}
                  >
                    {sendingReply ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  </button>
                </form>

                {replyError && (
                  <div style={{ fontSize: 11, color: "#ef4444", marginTop: 6, padding: "0 4px" }}>
                    ⚠️ {replyError}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: TEXT_MUTED,
                gap: 12,
              }}
            >
              <MessageSquare size={48} style={{ opacity: 0.2 }} />
              <span style={{ fontSize: 13 }}>Selecione uma conversa na lista</span>
            </div>
          )}
        </div>

        {/* ================================================================ */}
        {/* COLUNA 3: DOSSIER / RAIO-X DE ATRIBUIÇÃO                       */}
        {/* ================================================================ */}
        {showRightPanel && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              borderLeft: `1px solid ${BORDER}`,
              background: DARK_BG,
              overflowY: "auto",
              padding: "14px 14px",
              gap: 14,
            }}
          >
            {selectedLead ? (
              <>
                {/* Contact Card */}
                <div style={{ textAlign: "center" }}>
                  <div
                    style={{
                      width: 60,
                      height: 60,
                      borderRadius: "50%",
                      background: `linear-gradient(135deg, ${PURPLE}, #34c77b)`,
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 800,
                      fontSize: 20,
                      margin: "0 auto 8px",
                    }}
                  >
                    {getInitials(selectedLead.name)}
                  </div>
                  <div style={{ fontWeight: 800, fontSize: 14, color: "#fff" }}>{selectedLead.name || "Sem Nome"}</div>
                  <div style={{ fontSize: 11, color: TEXT_MUTED, marginTop: 2 }}>
                    {selectedLead.city ? `${selectedLead.city}${selectedLead.state ? `/${selectedLead.state}` : ""}` : "Localização não informada"}
                  </div>
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      marginTop: 6,
                      padding: "3px 10px",
                      borderRadius: 999,
                      background: selectedEvents.some((e) => e.event_name === "Purchase")
                        ? "rgba(255,215,0,0.15)"
                        : "rgba(123,57,252,0.15)",
                      border: `1px solid ${selectedEvents.some((e) => e.event_name === "Purchase") ? "rgba(255,215,0,0.3)" : "rgba(123,57,252,0.3)"}`,
                      fontSize: 10,
                      fontWeight: 700,
                      color: selectedEvents.some((e) => e.event_name === "Purchase") ? "#ffd700" : "#b394ff",
                    }}
                  >
                    {selectedEvents.some((e) => e.event_name === "Purchase") ? "💰 Cliente" : "⏳ Atendimento"}
                  </div>
                </div>

                <div style={{ width: "100%", height: 1, background: BORDER }} />

                {/* Contact Details */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontSize: 10, color: TEXT_MUTED, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: 1 }}>
                    Dados de Contato
                  </div>

                  <div style={{ padding: "8px 10px", borderRadius: 8, background: SURFACE, border: `1px solid ${BORDER}` }}>
                    <div style={{ fontSize: 10, color: TEXT_MUTED, marginBottom: 2 }}>Telefone</div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12, color: "#fff", fontWeight: 600 }}>+{formatPhone(selectedLead.phone)}</span>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(selectedLead.phone, "phone")}
                          style={{ background: "none", border: "none", color: TEXT_MUTED, cursor: "pointer", padding: 2 }}
                          title="Copiar"
                        >
                          {copiedKey === "phone" ? <Check size={12} style={{ color: "#34c77b" }} /> : <Copy size={12} />}
                        </button>
                        <a
                          href={`https://wa.me/${selectedLead.phone.replace(/\D/g, "")}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <button type="button" style={{ background: "none", border: "none", color: GREEN, cursor: "pointer", padding: 2 }}>
                            <MessageCircle size={12} />
                          </button>
                        </a>
                      </div>
                    </div>
                  </div>

                  <div style={{ padding: "8px 10px", borderRadius: 8, background: SURFACE, border: `1px solid ${BORDER}` }}>
                    <div style={{ fontSize: 10, color: TEXT_MUTED, marginBottom: 2 }}>Cliente / Origem</div>
                    <div style={{ fontSize: 12, color: "#fff", fontWeight: 600 }}>
                      {clientNameMap[selectedLead.client_id] || "—"}
                    </div>
                  </div>

                  <div style={{ padding: "8px 10px", borderRadius: 8, background: SURFACE, border: `1px solid ${BORDER}` }}>
                    <div style={{ fontSize: 10, color: TEXT_MUTED, marginBottom: 2 }}>Primeiro contato</div>
                    <div style={{ fontSize: 11, color: "#c4c0d9" }}>{formatDateTime(selectedLead.first_seen_at)}</div>
                  </div>
                </div>

                <div style={{ width: "100%", height: 1, background: BORDER }} />

                {/* Attribution / CTWA */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontSize: 10, color: TEXT_MUTED, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: 1 }}>
                    Atribuição Meta Ads
                  </div>

                  {/* ctwa_clid */}
                  <div style={{ padding: "8px 10px", borderRadius: 8, background: SURFACE, border: `1px solid ${selectedLead.ctwa_clid ? "rgba(52,199,123,0.3)" : BORDER}` }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                      <span style={{ fontSize: 10, color: TEXT_MUTED, fontWeight: 700 }}>CTWA_CLID</span>
                      {selectedLead.ctwa_clid && (
                        <button
                          type="button"
                          onClick={() => copyToClipboard(selectedLead.ctwa_clid!, "ctwa")}
                          style={{ background: "none", border: "none", color: "#34c77b", cursor: "pointer", fontSize: 10, display: "flex", alignItems: "center", gap: 2 }}
                        >
                          {copiedKey === "ctwa" ? <Check size={10} /> : <Copy size={10} />}
                          {copiedKey === "ctwa" ? "Copiado" : "Copiar"}
                        </button>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: selectedLead.ctwa_clid ? "#34c77b" : TEXT_MUTED,
                        wordBreak: "break-all" as const,
                        fontFamily: "monospace",
                      }}
                    >
                      {selectedLead.ctwa_clid || (
                        <span style={{ color: TEXT_MUTED, fontFamily: "inherit" }}>
                          Não capturado — {selectedLead.source_id ? "Rastreado por AD_ID" : "Lead orgânico"}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* source_id / ad_id */}
                  {selectedLead.source_id && (
                    <div style={{ padding: "8px 10px", borderRadius: 8, background: SURFACE, border: `1px solid ${BORDER}` }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                        <span style={{ fontSize: 10, color: TEXT_MUTED, fontWeight: 700 }}>AD_ID</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(selectedLead.source_id!, "adid")}
                          style={{ background: "none", border: "none", color: "#b394ff", cursor: "pointer", fontSize: 10, display: "flex", alignItems: "center", gap: 2 }}
                        >
                          {copiedKey === "adid" ? <Check size={10} /> : <Copy size={10} />}
                        </button>
                      </div>
                      <div style={{ fontSize: 10, color: "#b394ff", fontFamily: "monospace" }}>{selectedLead.source_id}</div>
                    </div>
                  )}

                  {/* Ad data from Meta */}
                  {selectedAd && (
                    <>
                      <div style={{ padding: "8px 10px", borderRadius: 8, background: SURFACE, border: `1px solid ${BORDER}` }}>
                        <div style={{ fontSize: 10, color: TEXT_MUTED, marginBottom: 2 }}>Campanha</div>
                        <div style={{ fontSize: 11, color: "#fff", fontWeight: 600 }}>
                          {selectedAd.campaign_name || "—"}
                        </div>
                      </div>
                      <div style={{ padding: "8px 10px", borderRadius: 8, background: SURFACE, border: `1px solid ${BORDER}` }}>
                        <div style={{ fontSize: 10, color: TEXT_MUTED, marginBottom: 2 }}>Conjunto</div>
                        <div style={{ fontSize: 11, color: "#c4c0d9" }}>{selectedAd.adset_name || "—"}</div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                        <div style={{ padding: "7px 8px", borderRadius: 8, background: SURFACE, border: `1px solid ${BORDER}` }}>
                          <div style={{ fontSize: 9, color: TEXT_MUTED }}>Gasto</div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#34c77b", marginTop: 1 }}>
                            {formatMoney(selectedAd.spend ?? 0, "BRL")}
                          </div>
                        </div>
                        <div style={{ padding: "7px 8px", borderRadius: 8, background: SURFACE, border: `1px solid ${BORDER}` }}>
                          <div style={{ fontSize: 9, color: TEXT_MUTED }}>Cliques</div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#38bdf8", marginTop: 1 }}>
                            {selectedAd.conversations ?? selectedAd.clicks ?? "—"}
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Ad thumbnail in dossier */}
                  {(selectedLead.thumbnail_url || selectedAd?.thumbnail_url) && (
                    <div style={{ borderRadius: 8, overflow: "hidden", border: `1px solid ${BORDER}` }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={selectedLead.thumbnail_url || selectedAd?.thumbnail_url}
                        alt="Criativo"
                        style={{ width: "100%", maxHeight: 110, objectFit: "cover", display: "block" }}
                      />
                      <div style={{ padding: "5px 8px", background: "rgba(10,8,24,0.9)", fontSize: 10, fontWeight: 600, color: "#c4c0d9" }}>
                        {selectedLead.headline || selectedAd?.creative_title || "Criativo do Anúncio"}
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ width: "100%", height: 1, background: BORDER }} />

                {/* CAPI Events timeline */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontSize: 10, color: TEXT_MUTED, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: 1 }}>
                    Conversões CAPI ({selectedEvents.length})
                  </div>
                  {selectedEvents.length === 0 ? (
                    <div
                      style={{
                        padding: "12px 10px",
                        borderRadius: 8,
                        background: SURFACE,
                        border: `1px solid ${BORDER}`,
                        fontSize: 11,
                        color: TEXT_MUTED,
                        textAlign: "center",
                      }}
                    >
                      Nenhuma venda registrada. Use o botão Enviar CAPI no chat.
                    </div>
                  ) : (
                    selectedEvents.map((ev) => (
                      <div
                        key={ev.id}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 8,
                          background: SURFACE,
                          border: `1px solid ${ev.event_name === "Purchase" ? "rgba(255,215,0,0.3)" : BORDER}`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          fontSize: 11,
                        }}
                      >
                        <div>
                          <strong style={{ color: ev.event_name === "Purchase" ? "#ffd700" : "#fff" }}>
                            {ev.event_name}
                          </strong>
                          <div style={{ fontSize: 10, color: TEXT_MUTED, marginTop: 1 }}>{formatDateTime(ev.created_at)}</div>
                        </div>
                        <span style={{ fontWeight: 700, color: "#34c77b" }}>
                          {ev.value ? formatMoney(ev.value, ev.currency || "BRL") : "✓"}
                        </span>
                      </div>
                    ))
                  )}
                </div>

                {/* Quick actions */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <Link href={`/leads/${selectedLead.id}`} style={{ textDecoration: "none" }}>
                    <button
                      type="button"
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        borderRadius: 8,
                        border: `1px solid ${BORDER}`,
                        background: "transparent",
                        color: "#c4c0d9",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                      }}
                    >
                      <User size={13} />
                      Ver Ficha Completa do Lead
                    </button>
                  </Link>
                </div>
              </>
            ) : (
              <div style={{ textAlign: "center", padding: "40px 10px", color: TEXT_MUTED, fontSize: 12 }}>
                Selecione um lead para ver o raio-x de atribuição.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
