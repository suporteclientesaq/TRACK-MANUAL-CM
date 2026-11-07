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
  Paperclip,
  Phone,
  Play,
  Pause,
  Plus,
  RefreshCw,
  Search,
  Send,
  Smile,
  Star,
  Tag,
  User,
  X,
  Zap,
} from "lucide-react";
import { sendEventAction, sendWhatsAppMessageAction } from "@/app/actions";
import { formatDateTime, formatMoney, formatPhone } from "@/lib/format";
import type { Lead } from "@/lib/types";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface ClientBasic {
  id: string;
  name: string;
  default_currency: string;
}

interface WaMessage {
  text?: string;
  at: string;
  fromMe?: boolean;
  type?: "text" | "audio" | "image" | "video" | "document" | "sticker" | "reaction";
  duration?: number;
  mediaUrl?: string;
  mimeType?: string;
  caption?: string;
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

// ---------------------------------------------------------------------------
// Helpers de avatar colorido
// ---------------------------------------------------------------------------

const AVATAR_GRADIENTS = [
  "linear-gradient(135deg,#7b39fc,#a855f7)",
  "linear-gradient(135deg,#2563eb,#7c3aed)",
  "linear-gradient(135deg,#059669,#0d9488)",
  "linear-gradient(135deg,#dc2626,#f97316)",
  "linear-gradient(135deg,#0ea5e9,#6366f1)",
  "linear-gradient(135deg,#d97706,#f59e0b)",
  "linear-gradient(135deg,#be185d,#ec4899)",
  "linear-gradient(135deg,#4f46e5,#06b6d4)",
];

function avatarGradient(str: string) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

function getInitials(name: string | null, phone: string) {
  if (name && name.trim()) {
    return name
      .split(" ")
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }
  return phone.slice(-2);
}

function timeStr(isoStr: string) {
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "12:00";
  }
}

function relativeDate(isoStr: string) {
  try {
    const d = new Date(isoStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) return timeStr(isoStr);
    if (diffDays === 1) return "Ontem";
    if (diffDays < 7) return `${diffDays}d`;
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  } catch {
    return "";
  }
}

function formatDuration(secs: number) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Componente: Player de Áudio (Voz) estilo WhatsApp
// ---------------------------------------------------------------------------

function AudioPlayer({ msg, isFromMe }: { msg: WaMessage; isFromMe: boolean }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const duration = msg.duration || 0;

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
  };

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => { setPlaying(false); setProgress(0); setCurrentTime(0); };
    const onTimeUpdate = () => {
      if (el.duration) {
        setProgress((el.currentTime / el.duration) * 100);
        setCurrentTime(el.currentTime);
      }
    };
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    el.addEventListener("timeupdate", onTimeUpdate);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("timeupdate", onTimeUpdate);
    };
  }, []);

  const bgColor = isFromMe ? "rgba(0,120,80,0.6)" : "rgba(255,255,255,0.08)";
  const accent = isFromMe ? "#34c77b" : "#7b39fc";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "8px 12px",
        borderRadius: "10px",
        background: bgColor,
        minWidth: "220px",
        maxWidth: "300px",
      }}
    >
      {msg.mediaUrl && (
        <audio ref={audioRef} src={msg.mediaUrl} preload="metadata" style={{ display: "none" }} />
      )}

      {/* Play / Pause button */}
      <button
        type="button"
        onClick={toggle}
        style={{
          width: "36px",
          height: "36px",
          borderRadius: "50%",
          background: accent,
          border: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: msg.mediaUrl ? "pointer" : "default",
          flexShrink: 0,
          color: "#fff",
        }}
      >
        {playing ? <Pause size={15} /> : <Play size={15} />}
      </button>

      {/* Waveform bars */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
        {/* progress bar */}
        <div style={{ position: "relative", height: "24px", display: "flex", alignItems: "center", gap: "2px" }}>
          {Array.from({ length: 28 }).map((_, i) => {
            const heights = [3, 5, 8, 12, 9, 6, 11, 7, 14, 10, 8, 13, 6, 10, 15, 11, 7, 9, 12, 5, 8, 10, 7, 11, 6, 9, 5, 4];
            const h = heights[i % heights.length];
            const pct = (i / 28) * 100;
            const filled = pct <= progress;
            return (
              <div
                key={i}
                style={{
                  width: "2px",
                  height: `${h}px`,
                  borderRadius: "1px",
                  background: filled ? accent : "rgba(255,255,255,0.25)",
                  transition: "background 0.1s",
                }}
              />
            );
          })}
        </div>
        <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.6)" }}>
          {playing ? formatDuration(currentTime) : formatDuration(duration)}
        </div>
      </div>

      {/* Mic icon */}
      <Mic size={14} style={{ color: "rgba(255,255,255,0.4)", flexShrink: 0 }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente: Bolha de mensagem
// ---------------------------------------------------------------------------

function MessageBubble({
  msg,
  idx,
  lead,
  isCtwa,
}: {
  msg: WaMessage;
  idx: number;
  lead: Lead;
  isCtwa: boolean;
}) {
  const isFromMe = Boolean(msg.fromMe);
  const type = msg.type || "text";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isFromMe ? "flex-end" : "flex-start",
        marginBottom: "2px",
      }}
    >
      <div
        style={{
          maxWidth: "72%",
          borderRadius: isFromMe ? "14px 14px 2px 14px" : "2px 14px 14px 14px",
          background: isFromMe
            ? "linear-gradient(135deg,#005c4b,#007a63)"
            : "#1a1627",
          border: isFromMe
            ? "1px solid rgba(52,199,123,0.25)"
            : "1px solid rgba(255,255,255,0.08)",
          padding: type === "audio" ? "8px 10px" : "9px 13px",
          color: "#fff",
          fontSize: "13.5px",
          lineHeight: "1.5",
          boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
          position: "relative",
        }}
      >
        {/* Nome do remetente na primeira msg recebida */}
        {!isFromMe && idx === 0 && (
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#7b39fc", marginBottom: "3px" }}>
            {lead.name || formatPhone(lead.phone)}
          </div>
        )}

        {/* Conteúdo da mensagem por tipo */}
        {type === "audio" ? (
          <AudioPlayer msg={msg} isFromMe={isFromMe} />
        ) : type === "image" ? (
          <div>
            {msg.mediaUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={msg.mediaUrl}
                alt="Imagem"
                style={{ width: "100%", maxWidth: "280px", borderRadius: "8px", display: "block", marginBottom: msg.caption ? "6px" : 0 }}
              />
            ) : (
              <div
                style={{
                  width: "240px",
                  height: "140px",
                  background: "rgba(255,255,255,0.05)",
                  borderRadius: "8px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: msg.caption ? "6px" : 0,
                }}
              >
                <ImageIcon size={30} style={{ opacity: 0.3 }} />
              </div>
            )}
            {msg.caption && <div style={{ fontSize: "13px", wordBreak: "break-word" }}>{msg.caption}</div>}
          </div>
        ) : type === "document" ? (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "8px",
                background: "rgba(123,57,252,0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Paperclip size={16} />
            </div>
            <div>
              <div style={{ fontSize: "12px", fontWeight: 600 }}>{msg.text || "Documento"}</div>
              <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.5)" }}>{msg.mimeType || "Arquivo"}</div>
            </div>
          </div>
        ) : (
          <div style={{ wordBreak: "break-word", whiteSpace: "pre-wrap" }}>
            {msg.text || "(mensagem sem texto)"}
          </div>
        )}

        {/* Timestamp + ticks */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "3px",
            marginTop: type === "audio" ? "0" : "4px",
            fontSize: "10px",
            color: "rgba(255,255,255,0.45)",
          }}
        >
          {isCtwa && !isFromMe && idx === 0 && (
            <span
              style={{
                fontSize: "9px",
                padding: "1px 5px",
                borderRadius: "4px",
                background: "rgba(52,199,123,0.2)",
                color: "#34c77b",
                fontWeight: 700,
                marginRight: "4px",
              }}
            >
              CTWA ✓
            </span>
          )}
          <span>{timeStr(msg.at)}</span>
          {isFromMe && <CheckCheck size={12} style={{ color: "#38bdf8" }} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente: Card de Anúncio CTWA (verde, estilo Leona Flow)
// ---------------------------------------------------------------------------

function CtwaAdCard({ lead, ad }: { lead: Lead; ad: any }) {
  const title = lead.headline || ad?.creative_title || ad?.ad_name || "Anúncio Meta Ads";
  const body = lead.ad_body || ad?.creative_body || "Anúncio Click-to-WhatsApp veiculado no Meta.";
  const thumb = lead.thumbnail_url || ad?.thumbnail_url;
  const campaign = ad?.campaign_name || null;

  return (
    <div
      style={{
        maxWidth: "340px",
        borderRadius: "10px",
        overflow: "hidden",
        border: "1px solid rgba(52,199,123,0.4)",
        background: "#111b13",
        alignSelf: "flex-start",
        boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
        marginBottom: "4px",
      }}
    >
      {/* Header verde */}
      <div
        style={{
          background: "#1b4d3e",
          borderBottom: "1px solid rgba(52,199,123,0.3)",
          padding: "7px 12px",
          display: "flex",
          alignItems: "center",
          gap: "6px",
          fontSize: "11px",
          fontWeight: 700,
          color: "#4ade80",
        }}
      >
        <Flame size={13} />
        <span>Conversão | Mesmo anúncio</span>
      </div>

      {/* Imagem + info */}
      {thumb && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumb}
          alt="Criativo"
          style={{ width: "100%", maxHeight: "160px", objectFit: "cover", display: "block" }}
        />
      )}

      <div style={{ padding: "10px 12px" }}>
        <div style={{ fontWeight: 700, fontSize: "13px", color: "#fff", marginBottom: "3px" }}>{title}</div>
        <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.55)", lineHeight: "1.4", marginBottom: campaign ? "5px" : 0 }}>
          {body}
        </div>
        {campaign && (
          <div style={{ fontSize: "10px", color: "#4ade80", fontWeight: 600 }}>
            📢 {campaign}
          </div>
        )}
      </div>

      {/* Footer com ctwa_clid */}
      {lead.ctwa_clid && (
        <div
          style={{
            padding: "5px 12px",
            borderTop: "1px solid rgba(52,199,123,0.2)",
            fontSize: "9px",
            color: "#34c77b",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>ctwa_clid capturado ✓</span>
          <span style={{ opacity: 0.6, fontFamily: "monospace" }}>#{lead.ctwa_clid.slice(0, 14)}…</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

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
  const [activeTab, setActiveTab] = useState<"todos" | "com-anuncio" | "com-venda" | "aguardando">("todos");

  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const [saleValue, setSaleValue] = useState<string>("197,00");
  const [sendingSale, setSendingSale] = useState(false);
  const [saleNotice, setSaleNotice] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatBodyRef = useRef<HTMLDivElement>(null);

  // Polling em tempo real (a cada 4s)
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
          }
        }
      } catch {
        // silencioso
      }
    };
    const interval = setInterval(fetchLive, 4000);
    return () => { active = false; clearInterval(interval); };
  }, [clientFilter, searchQuery]);

  // Scroll para o fim das mensagens ao selecionar lead
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selectedLeadId, currentLeads]);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Extrai texto da mensagem inicial
  const extractMessageText = (lead: Lead): string => {
    const rawObj = lead.raw && typeof lead.raw === "object" ? (lead.raw as Record<string, any>) : {};
    if (rawObj.message_text && typeof rawObj.message_text === "string" && rawObj.message_text.trim()) {
      return rawObj.message_text.trim();
    }
    if (lead.notes) {
      const m = lead.notes.match(/(?:WhatsApp|msg|Msg):\s*"?([^"\n\r]+)"?/i);
      if (m && m[1].trim()) return m[1].trim();
      if (!lead.notes.includes("PROPOSTA")) return lead.notes.trim();
    }
    return "Olá! Vi seu anúncio e gostaria de saber mais.";
  };

  // Obtém lista de mensagens do lead (histórico + inicial)
  const getMessages = useCallback((lead: Lead): WaMessage[] => {
    const rawObj = lead.raw && typeof lead.raw === "object" ? (lead.raw as Record<string, any>) : {};
    if (Array.isArray(rawObj.messages) && rawObj.messages.length > 0) {
      return rawObj.messages;
    }
    // Fallback: primeira mensagem a partir das notas/raw
    const text = extractMessageText(lead);
    return [{ text, at: lead.first_seen_at, fromMe: false, type: "text" }];
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Filtragem
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

  const selectedMessages = useMemo(() => {
    if (!selectedLead) return [];
    return getMessages(selectedLead);
  }, [selectedLead, getMessages]);

  const hasCtwa = Boolean(selectedLead?.ctwa_clid || selectedLead?.source_id || selectedLead?.headline);
  const selectedInitials = selectedLead ? getInitials(selectedLead.name, selectedLead.phone) : "";
  const selectedGradient = selectedLead ? avatarGradient(selectedLead.id) : "";

  // Envio de mensagem
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
            const rawObj = l.raw && typeof l.raw === "object" ? (l.raw as Record<string, any>) : {};
            const existingMessages = Array.isArray(rawObj.messages) ? rawObj.messages : [];
            return {
              ...l,
              raw: {
                ...rawObj,
                messages: [
                  ...existingMessages,
                  { text: msgToSend, at: new Date().toISOString(), fromMe: true, type: "text" },
                ],
              },
            };
          })
        );
      } else {
        setReplyError(res.error || "Não foi possível enviar. Verifique a conexão do WhatsApp.");
      }
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : String(err));
    } finally {
      setSendingReply(false);
    }
  };

  // Disparo rápido CAPI
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
        setSaleNotice(`✅ Venda de R$ ${saleValue} enviada ao Meta!`);
      } else {
        setSaleNotice(`❌ ${res.message || "Erro ao enviar conversão."}`);
      }
    } catch (err) {
      setSaleNotice(`❌ Falha: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSendingSale(false);
    }
  };

  // =========================================================================
  // RENDER
  // =========================================================================

  const C = {
    bg: "#0a0814",
    surface: "#100e1a",
    surface2: "#16122a",
    border: "rgba(255,255,255,0.07)",
    text: "#e9e4ff",
    muted: "#8b82a7",
    primary: "#7b39fc",
    green: "#25D366",
    greenDark: "#005c4b",
  };

  const TAB_STYLES = (active: boolean) => ({
    padding: "5px 11px",
    borderRadius: "6px",
    border: active ? "1px solid rgba(123,57,252,0.5)" : "1px solid transparent",
    background: active ? "rgba(123,57,252,0.2)" : "transparent",
    color: active ? "#c4b5fd" : C.muted,
    fontSize: "12px",
    fontWeight: active ? 700 : 500,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
    transition: "all 0.15s",
  });

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "300px 1fr 320px",
        height: "calc(100vh - 72px)",
        background: C.bg,
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        overflow: "hidden",
      }}
    >
      {/* ===================================================================
          COLUNA 1 — Lista de Conversas
          =================================================================== */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          borderRight: `1px solid ${C.border}`,
          background: C.surface,
          overflow: "hidden",
        }}
      >
        {/* Header da coluna */}
        <div style={{ padding: "14px 14px 10px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
            <span style={{ fontWeight: 700, fontSize: "15px", color: C.text }}>Conversas</span>
            <span
              style={{
                fontSize: "10px",
                fontWeight: 700,
                padding: "2px 7px",
                borderRadius: "999px",
                background: "rgba(52,199,123,0.15)",
                color: "#34c77b",
                display: "flex",
                alignItems: "center",
                gap: "3px",
              }}
            >
              <Zap size={10} />
              AO VIVO
            </span>
          </div>

          {/* Busca */}
          <div style={{ position: "relative", marginBottom: "8px" }}>
            <Search size={13} style={{ position: "absolute", left: "9px", top: "50%", transform: "translateY(-50%)", color: C.muted }} />
            <input
              type="text"
              placeholder="Buscar conversa..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: "100%",
                padding: "7px 9px 7px 28px",
                borderRadius: "8px",
                background: C.surface2,
                border: `1px solid ${C.border}`,
                color: C.text,
                fontSize: "12px",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Filtro de cliente */}
          {clients.length > 1 && (
            <select
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
              style={{
                width: "100%",
                padding: "6px 8px",
                borderRadius: "7px",
                background: C.surface2,
                border: `1px solid ${C.border}`,
                color: C.text,
                fontSize: "11px",
                marginBottom: "8px",
                outline: "none",
              }}
            >
              <option value="">Todos os Clientes</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}

          {/* Tabs de filtro rápido */}
          <div style={{ display: "flex", gap: "4px", overflowX: "auto", paddingBottom: "2px" }}>
            {[
              { id: "todos", label: "Todos" },
              { id: "com-anuncio", label: "🎯 Anúncio" },
              { id: "com-venda", label: "💰 Venda" },
              { id: "aguardando", label: "⏳ Sem venda" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as any)}
                style={TAB_STYLES(activeTab === tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Lista de contatos com scroll */}
        <div style={{ flex: 1, overflowY: "auto", padding: "6px 6px" }}>
          {filteredLeads.length === 0 ? (
            <div style={{ textAlign: "center", padding: "50px 10px", color: C.muted, fontSize: "12px" }}>
              <MessageSquare size={28} style={{ opacity: 0.3, margin: "0 auto 8px" }} />
              <div>Nenhuma conversa encontrada</div>
            </div>
          ) : (
            filteredLeads.map((lead) => {
              const isSelected = selectedLead?.id === lead.id;
              const leadEvents = currentEventsData[lead.id] || [];
              const purchase = leadEvents.find((e) => e.event_name === "Purchase");
              const hasLeadCtwa = Boolean(lead.ctwa_clid);
              const msgs = getMessages(lead);
              const lastMsg = msgs[msgs.length - 1];
              const lastType = lastMsg?.type || "text";
              const initials = getInitials(lead.name, lead.phone);
              const gradient = avatarGradient(lead.id);

              const lastMsgPreview = lastType === "audio"
                ? "🎤 Áudio"
                : lastType === "image"
                  ? "📷 Imagem"
                  : lastType === "document"
                    ? "📄 Documento"
                    : lastMsg?.text || extractMessageText(lead);

              return (
                <div
                  key={lead.id}
                  onClick={() => setSelectedLeadId(lead.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "9px 10px",
                    borderRadius: "10px",
                    cursor: "pointer",
                    marginBottom: "2px",
                    background: isSelected
                      ? "linear-gradient(90deg,rgba(123,57,252,0.22),rgba(123,57,252,0.08))"
                      : "transparent",
                    border: isSelected ? `1px solid rgba(123,57,252,0.4)` : "1px solid transparent",
                    transition: "all 0.1s",
                  }}
                >
                  {/* Avatar */}
                  <div
                    style={{
                      width: "42px",
                      height: "42px",
                      borderRadius: "50%",
                      background: gradient,
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                      fontSize: "14px",
                      flexShrink: 0,
                    }}
                  >
                    {initials}
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "2px" }}>
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: "13px",
                          color: isSelected ? "#fff" : C.text,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          maxWidth: "140px",
                        }}
                      >
                        {lead.name || formatPhone(lead.phone)}
                      </span>
                      <span style={{ fontSize: "10px", color: C.muted, whiteSpace: "nowrap" }}>
                        {relativeDate(lastMsg?.at || lead.first_seen_at)}
                      </span>
                    </div>

                    <div
                      style={{
                        fontSize: "11.5px",
                        color: C.muted,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        marginBottom: "3px",
                      }}
                    >
                      {lastMsg?.fromMe ? (
                        <span style={{ color: "rgba(52,199,123,0.7)" }}>✓ </span>
                      ) : null}
                      {lastMsgPreview}
                    </div>

                    {/* Tags */}
                    <div style={{ display: "flex", gap: "3px", flexWrap: "wrap" }}>
                      {hasLeadCtwa && (
                        <span
                          style={{
                            fontSize: "9px",
                            padding: "1px 5px",
                            borderRadius: "4px",
                            background: "rgba(52,199,123,0.15)",
                            color: "#34c77b",
                            fontWeight: 700,
                          }}
                        >
                          CTWA ✓
                        </span>
                      )}
                      {purchase && (
                        <span
                          style={{
                            fontSize: "9px",
                            padding: "1px 5px",
                            borderRadius: "4px",
                            background: "rgba(255,215,0,0.15)",
                            color: "#ffd700",
                            fontWeight: 700,
                          }}
                        >
                          {formatMoney(purchase.value, purchase.currency || "BRL")}
                        </span>
                      )}
                      {!hasLeadCtwa && !purchase && (
                        <span
                          style={{
                            fontSize: "9px",
                            padding: "1px 5px",
                            borderRadius: "4px",
                            background: "rgba(255,255,255,0.05)",
                            color: C.muted,
                          }}
                        >
                          Orgânico
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Contador */}
        <div
          style={{
            padding: "8px 14px",
            borderTop: `1px solid ${C.border}`,
            fontSize: "11px",
            color: C.muted,
            textAlign: "center",
          }}
        >
          {filteredLeads.length} conversa{filteredLeads.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* ===================================================================
          COLUNA 2 — Chat (Estilo WhatsApp Web)
          =================================================================== */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "#0c0a17",
        }}
      >
        {selectedLead ? (
          <>
            {/* Header do chat */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 18px",
                background: C.surface,
                borderBottom: `1px solid ${C.border}`,
                flexShrink: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                {/* Avatar */}
                <div
                  style={{
                    width: "42px",
                    height: "42px",
                    borderRadius: "50%",
                    background: selectedGradient,
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                    fontSize: "15px",
                    flexShrink: 0,
                  }}
                >
                  {selectedInitials}
                </div>

                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <strong style={{ fontSize: "14px", color: "#fff" }}>
                      {selectedLead.name || "Sem Nome"}
                    </strong>
                    {hasCtwa && (
                      <span
                        style={{
                          fontSize: "9px",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          background: "rgba(52,199,123,0.15)",
                          color: "#34c77b",
                          fontWeight: 700,
                        }}
                      >
                        CTWA META ✓
                      </span>
                    )}
                    {selectedAd?.campaign_name && (
                      <span
                        style={{
                          fontSize: "9px",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          background: "rgba(123,57,252,0.15)",
                          color: "#c4b5fd",
                          fontWeight: 600,
                          maxWidth: "180px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        #{selectedAd.campaign_name}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "11px", color: C.muted, marginTop: "1px" }}>
                    +{selectedLead.phone}
                    {selectedLead.city ? ` · ${selectedLead.city}` : ""}
                    {` · ${clientNameMap[selectedLead.client_id] || "—"}`}
                  </div>
                </div>
              </div>

              {/* Ações do header */}
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <a
                  href={`https://wa.me/${selectedLead.phone.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ textDecoration: "none" }}
                >
                  <button
                    type="button"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "5px",
                      padding: "5px 10px",
                      borderRadius: "7px",
                      background: "rgba(37,211,102,0.1)",
                      border: "1px solid rgba(37,211,102,0.3)",
                      color: "#25D366",
                      fontSize: "11px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    <Phone size={12} />
                    WA Web
                  </button>
                </a>
                <Link href={`/leads/${selectedLead.id}`}>
                  <button
                    type="button"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      padding: "5px 9px",
                      borderRadius: "7px",
                      background: "rgba(255,255,255,0.05)",
                      border: `1px solid ${C.border}`,
                      color: C.muted,
                      fontSize: "11px",
                      cursor: "pointer",
                    }}
                  >
                    <ChevronRight size={12} />
                    Detalhes
                  </button>
                </Link>
              </div>
            </div>

            {/* Corpo de mensagens */}
            <div
              ref={chatBodyRef}
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "20px 24px",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                background:
                  "radial-gradient(ellipse at 20% 80%,rgba(123,57,252,0.04) 0%,rgba(12,10,23,0.98) 60%)",
              }}
            >
              {/* Card CTWA no topo (se houver anúncio) */}
              {hasCtwa && (
                <CtwaAdCard lead={selectedLead} ad={selectedAd} />
              )}

              {/* Separador de data */}
              {selectedMessages.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "8px 0",
                  }}
                >
                  <span
                    style={{
                      fontSize: "11px",
                      color: C.muted,
                      background: "rgba(255,255,255,0.05)",
                      padding: "3px 10px",
                      borderRadius: "10px",
                    }}
                  >
                    {new Date(selectedMessages[0]?.at || selectedLead.first_seen_at).toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "long",
                      year: "numeric",
                    })}
                  </span>
                </div>
              )}

              {/* Mensagens */}
              {selectedMessages.map((msg, idx) => (
                <MessageBubble
                  key={idx}
                  msg={msg}
                  idx={idx}
                  lead={selectedLead}
                  isCtwa={hasCtwa}
                />
              ))}

              {/* Eventos CAPI (exibidos no meio do chat como linhas do sistema) */}
              {selectedEvents.map((ev) => (
                <div
                  key={ev.id}
                  style={{
                    alignSelf: "center",
                    background: ev.event_name === "Purchase"
                      ? "linear-gradient(90deg,rgba(255,215,0,0.1),rgba(52,199,123,0.1))"
                      : "rgba(56,189,248,0.08)",
                    border: ev.event_name === "Purchase"
                      ? "1px solid rgba(255,215,0,0.25)"
                      : "1px solid rgba(56,189,248,0.2)",
                    borderRadius: "8px",
                    padding: "6px 14px",
                    fontSize: "11px",
                    color: "#fff",
                    textAlign: "center",
                    marginTop: "4px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "5px", justifyContent: "center", fontWeight: 700 }}>
                    <BadgeCheck size={13} style={{ color: ev.event_name === "Purchase" ? "#ffd700" : "#38bdf8" }} />
                    {ev.event_name === "Purchase"
                      ? `🎉 COMPRA: ${formatMoney(ev.value, ev.currency || "BRL")}`
                      : `✓ ${ev.event_name} enviado ao Meta`}
                  </div>
                  <div style={{ fontSize: "10px", color: C.muted, marginTop: "2px" }}>
                    {formatDateTime(ev.created_at)}
                  </div>
                </div>
              ))}

              <div ref={messagesEndRef} />
            </div>

            {/* Rodapé de envio */}
            <div
              style={{
                flexShrink: 0,
                background: C.surface,
                borderTop: `1px solid ${C.border}`,
              }}
            >
              {/* Barra rápida de CAPI */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 16px",
                  borderBottom: `1px solid ${C.border}`,
                  background: "rgba(255,215,0,0.03)",
                }}
              >
                <DollarSign size={13} style={{ color: "#ffd700" }} />
                <span style={{ fontSize: "11px", color: C.muted }}>Marcar venda:</span>
                <span style={{ fontSize: "12px", color: "#ffd700", fontWeight: 700 }}>R$</span>
                <input
                  type="text"
                  value={saleValue}
                  onChange={(e) => setSaleValue(e.target.value)}
                  placeholder="197,00"
                  style={{
                    width: "70px",
                    padding: "3px 6px",
                    borderRadius: "6px",
                    background: "rgba(255,215,0,0.08)",
                    border: "1px solid rgba(255,215,0,0.2)",
                    color: "#ffd700",
                    fontWeight: 700,
                    fontSize: "12px",
                    textAlign: "center",
                    outline: "none",
                  }}
                />
                <button
                  type="button"
                  onClick={handleSendQuickSale}
                  disabled={sendingSale}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "4px 10px",
                    borderRadius: "6px",
                    background: "linear-gradient(90deg,#ffd700,#f59e0b)",
                    border: "none",
                    color: "#000",
                    fontWeight: 800,
                    fontSize: "11px",
                    cursor: "pointer",
                  }}
                >
                  {sendingSale ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
                  Enviar CAPI
                </button>
                {saleNotice && (
                  <span
                    style={{
                      fontSize: "11px",
                      color: saleNotice.startsWith("✅") ? "#34c77b" : "#ef4444",
                      marginLeft: "4px",
                    }}
                  >
                    {saleNotice}
                  </span>
                )}
              </div>

              {/* Input de mensagem */}
              <form
                onSubmit={handleSendMessage}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "10px 14px",
                }}
              >
                <button type="button" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", padding: "4px" }}>
                  <Smile size={20} />
                </button>
                <button type="button" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", padding: "4px" }}>
                  <Paperclip size={18} />
                </button>
                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) handleSendMessage(); }}
                  placeholder="Digite uma mensagem..."
                  disabled={sendingReply}
                  style={{
                    flex: 1,
                    padding: "9px 14px",
                    borderRadius: "20px",
                    background: C.surface2,
                    border: `1px solid ${C.border}`,
                    color: C.text,
                    fontSize: "13px",
                    outline: "none",
                  }}
                />
                <button
                  type="submit"
                  disabled={sendingReply || !replyText.trim()}
                  style={{
                    width: "40px",
                    height: "40px",
                    borderRadius: "50%",
                    background: replyText.trim() ? C.green : "rgba(255,255,255,0.08)",
                    border: "none",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: replyText.trim() ? "pointer" : "default",
                    flexShrink: 0,
                    transition: "background 0.2s",
                  }}
                >
                  {sendingReply ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
              </form>

              {replyError && (
                <div style={{ padding: "4px 16px 8px", fontSize: "11px", color: "#ef4444" }}>
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
              color: C.muted,
              gap: "12px",
            }}
          >
            <MessageCircle size={48} style={{ opacity: 0.2 }} />
            <div style={{ fontSize: "14px" }}>Selecione uma conversa</div>
          </div>
        )}
      </div>

      {/* ===================================================================
          COLUNA 3 — Dossier do Lead / Raio-X de Atribuição
          =================================================================== */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          borderLeft: `1px solid ${C.border}`,
          background: C.surface,
          overflowY: "auto",
        }}
      >
        {selectedLead ? (
          <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "14px" }}>
            {/* Avatar + Status */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", paddingBottom: "14px", borderBottom: `1px solid ${C.border}` }}>
              <div
                style={{
                  width: "64px",
                  height: "64px",
                  borderRadius: "50%",
                  background: selectedGradient,
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "22px",
                  fontWeight: 700,
                }}
              >
                {selectedInitials}
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontWeight: 700, fontSize: "15px", color: C.text }}>
                  {selectedLead.name || "Sem Nome"}
                </div>
                <div style={{ fontSize: "11px", color: C.muted, marginTop: "2px" }}>
                  {formatPhone(selectedLead.phone)}
                </div>
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                <span
                  style={{
                    fontSize: "10px",
                    padding: "3px 9px",
                    borderRadius: "999px",
                    background: selectedEvents.some((e) => e.event_name === "Purchase")
                      ? "rgba(255,215,0,0.15)"
                      : hasCtwa
                        ? "rgba(52,199,123,0.15)"
                        : "rgba(255,255,255,0.08)",
                    color: selectedEvents.some((e) => e.event_name === "Purchase")
                      ? "#ffd700"
                      : hasCtwa
                        ? "#34c77b"
                        : C.muted,
                    fontWeight: 700,
                  }}
                >
                  {selectedEvents.some((e) => e.event_name === "Purchase")
                    ? "🏆 Venda Realizada"
                    : hasCtwa
                      ? "Em Atendimento"
                      : "Aguardando"}
                </span>
              </div>
            </div>

            {/* Contato rápido */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ fontSize: "10px", color: C.muted, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.5px" }}>
                Contato
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 10px",
                  borderRadius: "8px",
                  background: C.surface2,
                  border: `1px solid ${C.border}`,
                }}
              >
                <span style={{ fontSize: "12px", color: C.text }}>+{selectedLead.phone}</span>
                <div style={{ display: "flex", gap: "4px" }}>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(selectedLead.phone, "phone")}
                    style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", padding: "2px" }}
                    title="Copiar"
                  >
                    {copiedKey === "phone" ? <Check size={13} style={{ color: "#34c77b" }} /> : <Copy size={13} />}
                  </button>
                  <a
                    href={`https://wa.me/${selectedLead.phone.replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <button
                      type="button"
                      style={{ background: "none", border: "none", color: "#25D366", cursor: "pointer", padding: "2px" }}
                      title="Abrir WhatsApp"
                    >
                      <MessageCircle size={13} />
                    </button>
                  </a>
                </div>
              </div>
              {selectedLead.email && (
                <div
                  style={{
                    padding: "7px 10px",
                    borderRadius: "8px",
                    background: C.surface2,
                    border: `1px solid ${C.border}`,
                    fontSize: "12px",
                    color: C.muted,
                  }}
                >
                  ✉️ {selectedLead.email}
                </div>
              )}
              {(selectedLead.city || selectedLead.state) && (
                <div
                  style={{
                    padding: "7px 10px",
                    borderRadius: "8px",
                    background: C.surface2,
                    border: `1px solid ${C.border}`,
                    fontSize: "12px",
                    color: C.muted,
                  }}
                >
                  📍 {[selectedLead.city, selectedLead.state].filter(Boolean).join(", ")}
                </div>
              )}
            </div>

            {/* Atribuição do Anúncio (CTWA) */}
            {(hasCtwa || selectedAd) && (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <div style={{ fontSize: "10px", color: C.muted, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.5px" }}>
                  Atribuição Meta Ads
                </div>

                {/* Thumbnail */}
                {(selectedLead.thumbnail_url || selectedAd?.thumbnail_url) && (
                  <div style={{ borderRadius: "8px", overflow: "hidden", border: `1px solid ${C.border}` }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={selectedLead.thumbnail_url || selectedAd?.thumbnail_url}
                      alt="Criativo"
                      style={{ width: "100%", maxHeight: "120px", objectFit: "cover", display: "block" }}
                    />
                    <div style={{ padding: "6px 8px", fontSize: "11px", fontWeight: 600, color: C.text, background: C.surface2 }}>
                      {selectedLead.headline || selectedAd?.creative_title || "Criativo do Anúncio"}
                    </div>
                  </div>
                )}

                {/* Campanha e Conjunto */}
                {selectedAd?.campaign_name && (
                  <div style={{ padding: "8px 10px", borderRadius: "8px", background: C.surface2, border: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: "9px", color: C.muted, textTransform: "uppercase" as const, fontWeight: 700 }}>Campanha</div>
                    <div style={{ fontSize: "12px", fontWeight: 600, color: C.text, marginTop: "2px" }}>{selectedAd.campaign_name}</div>
                  </div>
                )}
                {selectedAd?.adset_name && (
                  <div style={{ padding: "8px 10px", borderRadius: "8px", background: C.surface2, border: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: "9px", color: C.muted, textTransform: "uppercase" as const, fontWeight: 700 }}>Conjunto</div>
                    <div style={{ fontSize: "11px", color: C.text, marginTop: "2px" }}>{selectedAd.adset_name}</div>
                  </div>
                )}

                {/* Spend + Cliques */}
                {(selectedAd?.spend != null || selectedAd?.clicks != null) && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                    <div style={{ padding: "7px 8px", borderRadius: "8px", background: C.surface2, border: `1px solid ${C.border}`, textAlign: "center" as const }}>
                      <div style={{ fontSize: "9px", color: C.muted }}>Gasto</div>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: "#34c77b", marginTop: "1px" }}>
                        {formatMoney(selectedAd?.spend ?? 0, "BRL")}
                      </div>
                    </div>
                    <div style={{ padding: "7px 8px", borderRadius: "8px", background: C.surface2, border: `1px solid ${C.border}`, textAlign: "center" as const }}>
                      <div style={{ fontSize: "9px", color: C.muted }}>Cliques</div>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: "#38bdf8", marginTop: "1px" }}>
                        {selectedAd?.conversations ?? selectedAd?.clicks ?? "—"}
                      </div>
                    </div>
                  </div>
                )}

                {/* ctwa_clid */}
                <div style={{ padding: "8px 10px", borderRadius: "8px", background: C.surface2, border: `1px solid ${C.border}` }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "3px" }}>
                    <span style={{ fontSize: "9px", color: C.muted, fontWeight: 700, textTransform: "uppercase" as const }}>ctwa_clid</span>
                    {selectedLead.ctwa_clid && (
                      <button
                        type="button"
                        onClick={() => copyToClipboard(selectedLead.ctwa_clid!, "ctwa")}
                        style={{ background: "none", border: "none", color: copiedKey === "ctwa" ? "#34c77b" : C.muted, cursor: "pointer", fontSize: "10px", display: "flex", alignItems: "center", gap: "2px" }}
                      >
                        {copiedKey === "ctwa" ? <Check size={10} /> : <Copy size={10} />}
                        {copiedKey === "ctwa" ? "Copiado" : "Copiar"}
                      </button>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: "10px",
                      color: selectedLead.ctwa_clid ? "#34c77b" : C.muted,
                      fontFamily: "monospace",
                      wordBreak: "break-all" as const,
                    }}
                  >
                    {selectedLead.ctwa_clid || "Não capturado (orgânico)"}
                  </div>
                </div>

                {/* ad_id */}
                {selectedLead.source_id && (
                  <div style={{ padding: "8px 10px", borderRadius: "8px", background: C.surface2, border: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: "9px", color: C.muted, fontWeight: 700, textTransform: "uppercase" as const, marginBottom: "3px" }}>ad_id</div>
                    <div style={{ fontSize: "10px", color: "#c4b5fd", fontFamily: "monospace" }}>{selectedLead.source_id}</div>
                  </div>
                )}

                {/* Link para o anúncio */}
                {selectedLead.source_id && (
                  <a
                    href={`https://www.facebook.com/ads/library/?id=${selectedLead.source_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ textDecoration: "none" }}
                  >
                    <button
                      type="button"
                      style={{
                        width: "100%",
                        padding: "7px",
                        borderRadius: "7px",
                        background: "rgba(123,57,252,0.1)",
                        border: "1px solid rgba(123,57,252,0.3)",
                        color: "#c4b5fd",
                        fontSize: "11px",
                        fontWeight: 600,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "5px",
                      }}
                    >
                      <ExternalLink size={12} />
                      Ver Anúncio no Meta
                    </button>
                  </a>
                )}
              </div>
            )}

            {/* Histórico de conversões CAPI */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ fontSize: "10px", color: C.muted, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.5px" }}>
                Conversões CAPI ({selectedEvents.length})
              </div>
              {selectedEvents.length === 0 ? (
                <div
                  style={{
                    padding: "10px",
                    borderRadius: "8px",
                    background: C.surface2,
                    border: `1px solid ${C.border}`,
                    fontSize: "11px",
                    color: C.muted,
                    textAlign: "center" as const,
                  }}
                >
                  Nenhuma venda registrada. Use a barra de CAPI acima.
                </div>
              ) : (
                selectedEvents.map((ev) => (
                  <div
                    key={ev.id}
                    style={{
                      padding: "8px 10px",
                      borderRadius: "7px",
                      background: C.surface2,
                      border: ev.event_name === "Purchase" ? "1px solid rgba(255,215,0,0.25)" : `1px solid ${C.border}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontSize: "11px",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, color: ev.event_name === "Purchase" ? "#ffd700" : C.text }}>
                        {ev.event_name}
                      </div>
                      <div style={{ fontSize: "10px", color: C.muted, marginTop: "1px" }}>
                        {formatDateTime(ev.created_at)}
                      </div>
                    </div>
                    <span style={{ fontWeight: 700, color: "#34c77b", fontSize: "13px" }}>
                      {ev.value ? formatMoney(ev.value, ev.currency || "BRL") : "✓"}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Data de entrada */}
            <div
              style={{
                padding: "8px 10px",
                borderRadius: "8px",
                background: C.surface2,
                border: `1px solid ${C.border}`,
                fontSize: "11px",
                color: C.muted,
              }}
            >
              <span style={{ fontWeight: 600 }}>Primeiro contato:</span>{" "}
              {formatDateTime(selectedLead.first_seen_at)}
            </div>

            {/* Link para página de detalhes */}
            <Link href={`/leads/${selectedLead.id}`} style={{ textDecoration: "none" }}>
              <button
                type="button"
                style={{
                  width: "100%",
                  padding: "9px",
                  borderRadius: "8px",
                  background: "rgba(123,57,252,0.15)",
                  border: "1px solid rgba(123,57,252,0.3)",
                  color: "#c4b5fd",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                }}
              >
                <User size={14} />
                Abrir Perfil Completo do Lead
              </button>
            </Link>
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: C.muted,
              fontSize: "12px",
              gap: "8px",
            }}
          >
            <User size={28} style={{ opacity: 0.2 }} />
            <div>Selecione um lead</div>
          </div>
        )}
      </div>
    </div>
  );
}
