"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  MessageSquare,
  Phone,
  Power,
  QrCode,
  RefreshCw,
  Shield,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface SessionInfo {
  name: string;
  status: "STARTING" | "SCAN_QR_CODE" | "WORKING" | "FAILED" | "STOPPED";
  me?: {
    id: string;
    pushName?: string;
  };
  config?: {
    webhooks?: { url: string; events: string[] }[];
  };
}

interface RecentMessage {
  id: string;
  from: string;
  body: string;
  timestamp: number;
  fromMe: boolean;
}

interface WahaDashboardProps {
  wahaServerUrl: string;
  wahaSessionName: string;
  wahaApiKey: string;
  clientWebhookKey: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(status: string) {
  if (status === "WORKING") return "#34c77b";
  if (status === "SCAN_QR_CODE" || status === "STARTING") return "#f59e0b";
  return "#ef4444";
}

function statusLabel(status: string) {
  if (status === "WORKING") return "✅ Conectado";
  if (status === "SCAN_QR_CODE") return "📷 Aguardando QR";
  if (status === "STARTING") return "⏳ Iniciando...";
  if (status === "FAILED") return "❌ Falhou";
  if (status === "STOPPED") return "⛔ Parado";
  return "❓ Desconhecido";
}

function timeAgo(ts: number) {
  const diff = Math.floor((Date.now() - ts * 1000) / 1000);
  if (diff < 60) return `${diff}s atrás`;
  if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
  return `${Math.floor(diff / 86400)}d atrás`;
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function WahaDashboard({
  wahaServerUrl,
  wahaSessionName,
  wahaApiKey,
  clientWebhookKey,
}: WahaDashboardProps) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [messages, setMessages] = useState<RecentMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const baseUrl = wahaServerUrl.replace(/\/$/, "");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(wahaApiKey ? { "X-Api-Key": wahaApiKey } : {}),
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const webhookUrl = `${origin}/api/webhook/waha/${clientWebhookKey}`;

  // ─── Fetch session ───────────────────────────────────────────────────────

  const fetchSession = useCallback(async () => {
    if (!baseUrl || !wahaSessionName) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/sessions/${wahaSessionName}`, {
        headers,
        cache: "no-store",
      });
      if (!res.ok) {
        if (res.status === 404) {
          setSession(null);
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      } else {
        const data = await res.json();
        setSession(data);

        // Busca QR se em modo de scan
        if (data.status === "SCAN_QR_CODE") {
          fetchQr();
        } else {
          setQrCode(null);
        }
      }
      setLastRefresh(new Date());
    } catch (e) {
      setError("Não foi possível conectar ao WAHA: " + String(e));
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl, wahaSessionName, wahaApiKey]);

  // ─── Fetch QR ────────────────────────────────────────────────────────────

  const fetchQr = useCallback(async () => {
    try {
      const res = await fetch(`${baseUrl}/api/${wahaSessionName}/auth/qr`, {
        headers: { ...headers, Accept: "application/json" },
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        setQrCode(data.qr || data.value || null);
      }
    } catch {
      // silencioso, QR não crítico
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl, wahaSessionName, wahaApiKey]);

  // ─── Fetch Messages (via endpoint interno) ───────────────────────────────

  const fetchMessages = useCallback(async () => {
    // O endpoint embutido retorna mensagens recentes via /api/conversas/live
    try {
      const res = await fetch("/api/conversas/live", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const leads = (data.leads || []) as Array<{
        phone?: string;
        raw?: { message_text?: string; messages?: { text: string; at: number; fromMe: boolean }[] };
        updated_at?: string;
      }>;

      // Pega as últimas 10 mensagens de todos os leads, ordenadas por timestamp
      const allMsgs: RecentMessage[] = [];
      for (const lead of leads) {
        const msgs = lead.raw?.messages || [];
        for (const m of msgs) {
          allMsgs.push({
            id: `${lead.phone}-${m.at}`,
            from: lead.phone || "?",
            body: m.text,
            timestamp: m.at,
            fromMe: m.fromMe,
          });
        }
      }
      allMsgs.sort((a, b) => b.timestamp - a.timestamp);
      setMessages(allMsgs.slice(0, 15));
    } catch {
      // silencioso
    }
  }, []);

  // ─── Ações ────────────────────────────────────────────────────────────────

  const startSession = async () => {
    setActionLoading("start");
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/sessions/${wahaSessionName}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: wahaSessionName }),
      });
      if (!res.ok) throw new Error(await res.text());
      await new Promise((r) => setTimeout(r, 1500));
      await fetchSession();
    } catch (e) {
      setError("Erro ao iniciar sessão: " + String(e));
    } finally {
      setActionLoading(null);
    }
  };

  const stopSession = async () => {
    setActionLoading("stop");
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/sessions/${wahaSessionName}`, {
        method: "DELETE",
        headers,
      });
      if (!res.ok) throw new Error(await res.text());
      await new Promise((r) => setTimeout(r, 800));
      await fetchSession();
    } catch (e) {
      setError("Erro ao parar sessão: " + String(e));
    } finally {
      setActionLoading(null);
    }
  };

  const reconnectSession = async () => {
    setActionLoading("reconnect");
    setError(null);
    try {
      // Para e reinicia
      await fetch(`${baseUrl}/api/sessions/${wahaSessionName}`, {
        method: "DELETE",
        headers,
      });
      await new Promise((r) => setTimeout(r, 1000));
      const res = await fetch(`${baseUrl}/api/sessions/${wahaSessionName}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: wahaSessionName }),
      });
      if (!res.ok) throw new Error(await res.text());
      await new Promise((r) => setTimeout(r, 1500));
      await fetchSession();
    } catch (e) {
      setError("Erro ao reconectar: " + String(e));
    } finally {
      setActionLoading(null);
    }
  };

  // ─── Auto-poll ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!baseUrl || !wahaSessionName) return;
    fetchSession();
    fetchMessages();
    const interval = setInterval(() => {
      fetchSession();
      fetchMessages();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchSession, fetchMessages]);

  // ─── Copy helper ─────────────────────────────────────────────────────────

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2500);
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  if (!baseUrl || !wahaSessionName) {
    return (
      <div
        style={{
          padding: "24px",
          borderRadius: "12px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          textAlign: "center",
          color: "var(--text-muted)",
        }}
      >
        <Zap size={32} style={{ marginBottom: "12px", opacity: 0.4 }} />
        <p style={{ margin: 0 }}>Configure a URL do servidor WAHA e o nome da sessão acima para ver o painel.</p>
      </div>
    );
  }

  const isWorking = session?.status === "WORKING";
  const isScanQr = session?.status === "SCAN_QR_CODE";
  const isStarting = session?.status === "STARTING";
  const noSession = !session;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* ── Cabeçalho do Painel ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "10px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: session ? statusColor(session.status) : "#6b7280",
              display: "inline-block",
              boxShadow: isWorking ? "0 0 0 3px rgba(52,199,123,0.25)" : undefined,
            }}
          />
          <span style={{ fontWeight: 700, fontSize: "15px" }}>
            Painel WAHA {session ? `— ${statusLabel(session.status)}` : "— Sem sessão"}
          </span>
          {session?.me && (
            <span
              style={{
                fontSize: "12px",
                background: "rgba(52,199,123,0.12)",
                color: "#34c77b",
                padding: "2px 8px",
                borderRadius: "999px",
                fontWeight: 600,
              }}
            >
              <Phone size={11} style={{ marginRight: 4, verticalAlign: "middle" }} />
              {session.me.id.replace("@s.whatsapp.net", "").replace("@c.us", "")}
              {session.me.pushName && ` · ${session.me.pushName}`}
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {lastRefresh && (
            <span style={{ fontSize: "11px", color: "var(--text-muted)", opacity: 0.7 }}>
              Atualizado {timeAgo(Math.floor(lastRefresh.getTime() / 1000))}
            </span>
          )}
          <button
            onClick={() => { fetchSession(); fetchMessages(); }}
            disabled={loading}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 12px",
              borderRadius: "8px",
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--text)",
              fontSize: "12px",
              cursor: loading ? "not-allowed" : "pointer",
              fontWeight: 600,
            }}
          >
            {loading ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
            Atualizar
          </button>
        </div>
      </div>

      {/* ── Erro ── */}
      {error && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "8px",
            padding: "10px 14px",
            borderRadius: "8px",
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.3)",
            color: "#fca5a5",
            fontSize: "13px",
          }}
        >
          <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          {error}
        </div>
      )}

      {/* ── Grid Principal ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
        {/* Card Status */}
        <div
          className="card"
          style={{ display: "flex", flexDirection: "column", gap: "14px" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 700, fontSize: "13px" }}>
            <Activity size={15} />
            Status da Sessão
          </div>

          <div
            style={{
              padding: "14px",
              borderRadius: "10px",
              background: "var(--bg)",
              border: `1px solid ${session ? statusColor(session.status) + "55" : "var(--border)"}`,
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
              <span style={{ color: "var(--text-muted)" }}>Sessão</span>
              <code style={{ color: "var(--text)", fontWeight: 600 }}>{wahaSessionName}</code>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
              <span style={{ color: "var(--text-muted)" }}>Status</span>
              <span style={{ color: session ? statusColor(session.status) : "#6b7280", fontWeight: 700 }}>
                {session ? statusLabel(session.status) : "— Nenhuma sessão"}
              </span>
            </div>
            {session?.me && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                <span style={{ color: "var(--text-muted)" }}>Número</span>
                <span style={{ fontWeight: 600, color: "#34c77b" }}>
                  +{session.me.id.replace("@s.whatsapp.net", "").replace("@c.us", "")}
                </span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
              <span style={{ color: "var(--text-muted)" }}>Servidor</span>
              <a
                href={baseUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: "#7b39fc", textDecoration: "none", fontWeight: 600, display: "flex", alignItems: "center", gap: "3px" }}
              >
                {baseUrl.replace(/^https?:\/\//, "").slice(0, 30)}
                <ExternalLink size={10} />
              </a>
            </div>
          </div>

          {/* Botões de Ação */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {(noSession || session?.status === "STOPPED" || session?.status === "FAILED") && (
              <button
                onClick={startSession}
                disabled={!!actionLoading}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  padding: "10px",
                  borderRadius: "8px",
                  border: "none",
                  background: "linear-gradient(135deg, #34c77b, #00f2fe)",
                  color: "#000",
                  fontWeight: 700,
                  fontSize: "13px",
                  cursor: actionLoading ? "not-allowed" : "pointer",
                }}
              >
                {actionLoading === "start" ? <Loader2 size={14} className="spin" /> : <Power size={14} />}
                Iniciar Sessão
              </button>
            )}

            {isWorking && (
              <button
                onClick={reconnectSession}
                disabled={!!actionLoading}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  padding: "10px",
                  borderRadius: "8px",
                  border: "1px solid #7b39fc",
                  background: "rgba(123,57,252,0.1)",
                  color: "#b394ff",
                  fontWeight: 700,
                  fontSize: "13px",
                  cursor: actionLoading ? "not-allowed" : "pointer",
                }}
              >
                {actionLoading === "reconnect" ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
                Reconectar
              </button>
            )}

            {isScanQr && (
              <button
                onClick={fetchQr}
                disabled={!!actionLoading}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  padding: "10px",
                  borderRadius: "8px",
                  border: "1px solid #f59e0b",
                  background: "rgba(245,158,11,0.1)",
                  color: "#fbbf24",
                  fontWeight: 700,
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                <QrCode size={14} />
                Atualizar QR Code
              </button>
            )}

            {!noSession && !isStarting && (
              <button
                onClick={stopSession}
                disabled={!!actionLoading}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  padding: "10px",
                  borderRadius: "8px",
                  border: "1px solid rgba(239,68,68,0.4)",
                  background: "rgba(239,68,68,0.08)",
                  color: "#fca5a5",
                  fontWeight: 700,
                  fontSize: "13px",
                  cursor: actionLoading ? "not-allowed" : "pointer",
                }}
              >
                {actionLoading === "stop" ? <Loader2 size={14} className="spin" /> : <WifiOff size={14} />}
                Parar Sessão
              </button>
            )}
          </div>
        </div>

        {/* Card QR Code ou Conexão OK */}
        <div
          className="card"
          style={{ display: "flex", flexDirection: "column", gap: "14px", alignItems: "center", justifyContent: "center" }}
        >
          {isWorking && (
            <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: "50%",
                  background: "rgba(52,199,123,0.15)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Wifi size={32} color="#34c77b" />
              </div>
              <div style={{ fontWeight: 700, fontSize: "15px", color: "#34c77b" }}>WhatsApp Conectado!</div>
              {session?.me && (
                <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                  {session.me.pushName && <div style={{ fontWeight: 600, color: "var(--text)" }}>{session.me.pushName}</div>}
                  <div>+{session.me.id.replace("@s.whatsapp.net", "").replace("@c.us", "")}</div>
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 14px",
                  borderRadius: "999px",
                  background: "rgba(52,199,123,0.12)",
                  color: "#34c77b",
                  fontSize: "12px",
                  fontWeight: 600,
                }}
              >
                <CheckCircle2 size={13} />
                Recebendo mensagens em tempo real
              </div>
            </div>
          )}

          {(isScanQr || isStarting) && (
            <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", width: "100%" }}>
              <div style={{ fontWeight: 700, fontSize: "13px", color: "#fbbf24" }}>
                {isStarting ? "⏳ Iniciando conexão..." : "📷 Escaneie o QR Code"}
              </div>
              {qrCode ? (
                <div
                  style={{
                    padding: "12px",
                    background: "#fff",
                    borderRadius: "12px",
                    display: "inline-block",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={
                      qrCode.startsWith("data:")
                        ? qrCode
                        : qrCode.length > 200
                          ? `data:image/png;base64,${qrCode}`
                          : `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrCode)}`
                    }
                    alt="QR Code WhatsApp"
                    width={180}
                    height={180}
                    style={{ display: "block", borderRadius: "4px" }}
                  />
                </div>
              ) : (
                <div
                  style={{
                    width: 180,
                    height: 180,
                    borderRadius: "12px",
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexDirection: "column",
                    gap: "8px",
                    color: "var(--text-muted)",
                  }}
                >
                  <Loader2 size={28} className="spin" />
                  <span style={{ fontSize: "11px" }}>Carregando QR...</span>
                </div>
              )}
              <p style={{ margin: 0, fontSize: "11px", color: "var(--text-muted)", maxWidth: 200 }}>
                Abra o WhatsApp → Aparelhos conectados → Conectar aparelho
              </p>
            </div>
          )}

          {noSession && !loading && (
            <div style={{ textAlign: "center", color: "var(--text-muted)", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
              <WifiOff size={36} style={{ opacity: 0.3 }} />
              <div style={{ fontSize: "13px" }}>Nenhuma sessão ativa</div>
              <div style={{ fontSize: "11px" }}>Clique em &quot;Iniciar Sessão&quot; para conectar</div>
            </div>
          )}

          {loading && !session && (
            <div style={{ textAlign: "center", color: "var(--text-muted)", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
              <Loader2 size={28} className="spin" />
              <div style={{ fontSize: "12px" }}>Verificando sessão...</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Webhook ── */}
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 700, fontSize: "13px" }}>
          <Shield size={15} />
          Webhook WAHA
        </div>
        <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted)" }}>
          Configure este URL no seu servidor WAHA para que as mensagens cheguem ao Track Manual em tempo real.
        </p>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <code
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: "8px",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              fontSize: "11px",
              overflowX: "auto",
              color: "var(--text)",
              display: "block",
              whiteSpace: "nowrap",
            }}
          >
            {webhookUrl}
          </code>
          <button
            onClick={() => copy(webhookUrl, "webhook")}
            style={{
              padding: "8px 12px",
              borderRadius: "8px",
              border: "1px solid var(--border)",
              background: copied === "webhook" ? "rgba(52,199,123,0.15)" : "var(--surface)",
              color: copied === "webhook" ? "#34c77b" : "var(--text)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "5px",
              fontSize: "12px",
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {copied === "webhook" ? <CheckCircle2 size={13} /> : <Copy size={13} />}
            {copied === "webhook" ? "Copiado!" : "Copiar"}
          </button>
        </div>

        {/* Eventos sugeridos */}
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {["message", "message.any", "session.status"].map((ev) => (
            <span
              key={ev}
              style={{
                fontSize: "11px",
                padding: "2px 8px",
                borderRadius: "999px",
                background: "rgba(123,57,252,0.12)",
                color: "#b394ff",
                fontWeight: 600,
              }}
            >
              {ev}
            </span>
          ))}
          <span style={{ fontSize: "11px", color: "var(--text-muted)", alignSelf: "center" }}>
            eventos recomendados
          </span>
        </div>
      </div>

      {/* ── Mensagens Recentes ── */}
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 700, fontSize: "13px" }}>
          <MessageSquare size={15} />
          Mensagens Recentes ({messages.length})
        </div>

        {messages.length === 0 ? (
          <div
            style={{
              padding: "24px",
              textAlign: "center",
              color: "var(--text-muted)",
              fontSize: "13px",
              background: "var(--bg)",
              borderRadius: "10px",
              border: "1px solid var(--border)",
            }}
          >
            Nenhuma mensagem capturada ainda. Aguardando conexão e atividade...
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "280px", overflowY: "auto" }}>
            {messages.map((msg) => (
              <div
                key={msg.id}
                style={{
                  display: "flex",
                  flexDirection: msg.fromMe ? "row-reverse" : "row",
                  gap: "8px",
                  alignItems: "flex-start",
                }}
              >
                <div
                  style={{
                    padding: "7px 11px",
                    borderRadius: msg.fromMe ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                    background: msg.fromMe ? "rgba(52,199,123,0.18)" : "var(--surface)",
                    border: `1px solid ${msg.fromMe ? "rgba(52,199,123,0.3)" : "var(--border)"}`,
                    maxWidth: "70%",
                  }}
                >
                  {!msg.fromMe && (
                    <div style={{ fontSize: "10px", fontWeight: 700, color: "#7b39fc", marginBottom: "3px" }}>
                      +{msg.from}
                    </div>
                  )}
                  <div style={{ fontSize: "12px", color: "var(--text)", lineHeight: 1.4 }}>{msg.body}</div>
                  <div
                    style={{
                      fontSize: "10px",
                      color: "var(--text-muted)",
                      marginTop: "3px",
                      textAlign: msg.fromMe ? "left" : "right",
                    }}
                  >
                    {timeAgo(msg.timestamp)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
