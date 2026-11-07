"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  Box,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  LogOut,
  QrCode,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Zap,
} from "lucide-react";
import {
  connectEvolutionAction,
  disconnectEvolutionAction,
  getEvolutionStatusAction,
  connectWahaAction,
  disconnectWahaAction,
  getWahaStatusAction,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import type { Client } from "@/lib/types";
import { WahaDashboard } from "./WahaDashboard";

interface WhatsAppClientProps {
  clients: Client[];
}

// Funções de fetch para o modo nativo (API route → evita React error #441 de Server Actions)
async function nativeStatus(clientId: string) {
  const res = await fetch(`/api/whatsapp/${clientId}/status`, { cache: "no-store" });
  return res.json() as Promise<{
    ok: boolean;
    state: "open" | "connecting" | "close";
    qrcode: string | null;
    phone: string | null;
    name: string | null;
  }>;
}

async function nativeConnect(clientId: string) {
  const res = await fetch(`/api/whatsapp/${clientId}/status`, { method: "POST", cache: "no-store" });
  return res.json() as Promise<{
    ok: boolean;
    state: "open" | "connecting" | "close";
    qrcode: string | null;
    phone: string | null;
    error: string | null;
  }>;
}

async function nativeDisconnect(clientId: string) {
  const res = await fetch(`/api/whatsapp/${clientId}/status`, { method: "DELETE", cache: "no-store" });
  return res.json() as Promise<{ ok: boolean; error?: string }>;
}

export function WhatsAppClient({ clients }: WhatsAppClientProps) {
  const [selectedClientId, setSelectedClientId] = useState(clients[0]?.id || "");
  const [connectionMode, setConnectionMode] = useState<"native" | "waha" | "evolution">("native");

  // Configurações do modo Evolution API
  const [serverUrl, setServerUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [instanceName, setInstanceName] = useState(
    clients[0] ? `track_${clients[0].name.toLowerCase().replace(/\W+/g, "_")}` : "track_whats"
  );

  // Configurações do modo WAHA (WhatsApp HTTP API)
  const [wahaServerUrl, setWahaServerUrl] = useState("");
  const [wahaApiKey, setWahaApiKey] = useState("");
  const [wahaSessionName, setWahaSessionName] = useState("default");

  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [connectionState, setConnectionState] = useState<"close" | "connecting" | "open" | "unknown">("unknown");
  const [connectedPhone, setConnectedPhone] = useState<string | null>(null);
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Origem do browser para construir URLs de webhook completas
  const [origin, setOrigin] = useState("http://localhost:3000");

  // Restaura preferências salvas no navegador para NUNCA voltar pro nativo sem querer
  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
      const savedMode = localStorage.getItem("track_wa_mode") as "native" | "waha" | "evolution" | null;
      if (savedMode) setConnectionMode(savedMode);

      const savedClient = localStorage.getItem("track_wa_client_id");
      if (savedClient && clients.some((c) => c.id === savedClient)) {
        setSelectedClientId(savedClient);
      }

      const savedWahaUrl = localStorage.getItem("track_waha_url");
      if (savedWahaUrl) {
        setWahaServerUrl(savedWahaUrl);
      } else {
        setWahaServerUrl(`${window.location.origin}/api/waha`);
      }

      const savedWahaSession = localStorage.getItem("track_waha_session");
      if (savedWahaSession) setWahaSessionName(savedWahaSession);

      const savedWahaKey = localStorage.getItem("track_waha_key");
      if (savedWahaKey) setWahaApiKey(savedWahaKey);
    }
  }, [clients]);

  const changeConnectionMode = (mode: "native" | "waha" | "evolution") => {
    setConnectionMode(mode);
    setQrCodeData(null);
    setErrorMessage(null);
    setConnectionState("unknown");
    if (typeof window !== "undefined") {
      localStorage.setItem("track_wa_mode", mode);
    }
  };

  // Persiste configurações WAHA no localStorage para sobreviver a recargas/navegação
  useEffect(() => {
    if (typeof window !== "undefined" && wahaServerUrl)
      localStorage.setItem("track_waha_url", wahaServerUrl);
  }, [wahaServerUrl]);

  useEffect(() => {
    if (typeof window !== "undefined")
      localStorage.setItem("track_waha_session", wahaSessionName);
  }, [wahaSessionName]);

  useEffect(() => {
    if (typeof window !== "undefined")
      localStorage.setItem("track_waha_key", wahaApiKey);
  }, [wahaApiKey]);

  const currentClient = clients.find((c) => c.id === selectedClientId) || clients[0];
  const wahaWebhookUrl = `${origin}/api/webhook/waha/${currentClient?.webhook_key || ""}`;
  const dockerCommand = "docker run -d --name waha -p 3008:3000 -v waha_data:/app/.sessions devlikeapro/waha:latest";

  const [wahaTesting, setWahaTesting] = useState(false);
  const [wahaTestResult, setWahaTestResult] = useState<string | null>(null);

  const copyToClipboard = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2500);
  };

  const testWahaWebhook = async () => {
    if (!currentClient?.webhook_key) return;
    setWahaTesting(true);
    setWahaTestResult(null);
    try {
      const res = await fetch(`/api/webhook/waha/${currentClient.webhook_key}`);
      const data = await res.json();
      if (data.ok) {
        setWahaTestResult("✅ Endpoint do Webhook WAHA ativo e respondendo com sucesso!");
      } else {
        setWahaTestResult("⚠️ Erro: " + (data.error || "Resposta inesperada"));
      }
    } catch (e) {
      setWahaTestResult("❌ Falha ao testar endpoint: " + String(e));
    } finally {
      setWahaTesting(false);
    }
  };

  // Troca de cliente atualiza o nome padrão da instância e checa status
  const handleClientSelect = (cId: string) => {
    setSelectedClientId(cId);
    setQrCodeData(null);
    setConnectionState("unknown");
    if (typeof window !== "undefined") {
      localStorage.setItem("track_wa_client_id", cId);
    }
    const cl = clients.find((c) => c.id === cId);
    if (cl) {
      setInstanceName(`track_${cl.name.toLowerCase().replace(/\W+/g, "_")}`);
    }
  };

  // Checa status da conexão (Nativo, WAHA ou Evolution)
  const checkStatus = async () => {
    if (!selectedClientId) return;
    // Não verifica WAHA/Evolution sem URL configurada
    if (connectionMode === "waha" && !wahaServerUrl.trim()) return;
    if (connectionMode === "evolution" && !serverUrl.trim()) return;

    setChecking(true);
    setErrorMessage(null);
    try {
      if (connectionMode === "native") {
        const res = await nativeStatus(selectedClientId);
        if (res.ok) {
          if (res.state === "open") {
            setConnectionState("open");
            setQrCodeData(null);
            if (res.phone) setConnectedPhone(res.phone);
          } else if (res.state === "connecting" && res.qrcode) {
            setConnectionState("connecting");
            setQrCodeData(res.qrcode);
          } else if (res.phone && !res.qrcode) {
            // Sessão com credenciais salvas em reconexão transparente
            setConnectionState("open");
            setConnectedPhone(res.phone);
            setQrCodeData(null);
          } else if (res.state === "close") {
            setConnectionState("close");
          }
        } else {
          setConnectionState("close");
        }
      } else if (connectionMode === "waha") {
        const res = await getWahaStatusAction({
          serverUrl: wahaServerUrl,
          apiKey: wahaApiKey,
          sessionName: wahaSessionName,
        });
        if (res.ok) {
          if (res.state === "open") {
            setConnectionState("open");
            setQrCodeData(null);
            if (res.phone) setConnectedPhone(res.phone);
          } else if (res.state === "connecting") {
            setConnectionState("connecting");
            if (res.qrcode) setQrCodeData(res.qrcode);
            // Se connecting mas sem QR ainda, não muda estado
          } else {
            setConnectionState("close");
          }
        } else {
          setConnectionState("close");
          if (res.error && !res.error.includes("404") && !res.error.includes("not_found")) {
            setErrorMessage(res.error);
          }
        }
      } else {
        if (!serverUrl.trim() || !apiKey.trim() || !instanceName.trim()) {
          setConnectionState("close");
          return;
        }
        const res = await getEvolutionStatusAction({ serverUrl, apiKey, instanceName });
        if (res.ok) {
          if (res.state === "open") {
            setConnectionState("open");
            setQrCodeData(null);
            if (res.phone) setConnectedPhone(res.phone);
          } else if (res.state === "connecting") {
            setConnectionState("connecting");
          } else {
            setConnectionState("close");
          }
        } else {
          setConnectionState("close");
          if (res.error && !res.error.includes("404") && !res.error.includes("not_found")) {
            setErrorMessage(res.error);
          }
        }
      }
    } catch (e) {
      setConnectionState("close");
      setErrorMessage("Erro ao verificar status: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setChecking(false);
    }
  };

  // Conectar / Gerar QR Code
  const handleConnect = async () => {
    if (!selectedClientId) {
      setErrorMessage("Cadastre e selecione um cliente primeiro.");
      return;
    }
    setLoading(true);
    setErrorMessage(null);
    setSuccessNotice(null);
    try {
      if (connectionMode === "native") {
        const res = await nativeConnect(selectedClientId);
        if (res.ok) {
          if (res.state === "open") {
            setConnectionState("open");
            setQrCodeData(null);
            if (res.phone) setConnectedPhone(res.phone);
            setSuccessNotice("WhatsApp conectado com sucesso e pronto para rastreamento!");
          } else {
            setConnectionState("connecting");
            if (res.qrcode) setQrCodeData(res.qrcode);
          }
        } else {
          setErrorMessage(res.error || "Não foi possível iniciar o WhatsApp nativo.");
        }
      } else if (connectionMode === "waha") {
        if (!wahaServerUrl.trim()) {
          setErrorMessage("Informe o endereço da API do WAHA (ex: http://seu-ip:3000 ou https://waha.seudominio.com).");
          setLoading(false);
          return;
        }
        const res = await connectWahaAction({
          serverUrl: wahaServerUrl,
          apiKey: wahaApiKey,
          sessionName: wahaSessionName,
          clientId: selectedClientId,
        });
        if (res.ok) {
          if (res.state === "open") {
            setConnectionState("open");
            setQrCodeData(null);
            if (res.phone) setConnectedPhone(res.phone);
            setSuccessNotice("WhatsApp conectado com sucesso via WAHA!");
          } else {
            setConnectionState("connecting");
            if (res.qrcode) setQrCodeData(res.qrcode);
          }
        } else {
          setErrorMessage(res.error || "Não foi possível conectar ao WAHA.");
        }
      } else if (connectionMode === "evolution") {
        if (!serverUrl.trim() || !apiKey.trim() || !instanceName.trim()) {
          setErrorMessage("Preencha o Nome da Instância, Endereço e Chave da Evolution API.");
          setLoading(false);
          return;
        }
        const res = await connectEvolutionAction({
          serverUrl,
          apiKey,
          instanceName,
          clientId: selectedClientId,
        });
        if (res.ok) {
          if (res.state === "open") {
            setConnectionState("open");
            setQrCodeData(null);
            if (res.phone) setConnectedPhone(res.phone);
            setSuccessNotice("WhatsApp já está conectado e pronto para rastreamento!");
          } else {
            setConnectionState("connecting");
            if (res.qrcode) setQrCodeData(res.qrcode);
          }
        } else {
          setErrorMessage(res.error || "Não foi possível conectar à Evolution API.");
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMessage("Erro ao conectar: " + msg);
    } finally {
      setLoading(false);
    }
  };

  // Desconectar WhatsApp
  const handleDisconnect = async () => {
    if (!confirm("Tem certeza que deseja desconectar este WhatsApp?")) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      if (connectionMode === "native") {
        await nativeDisconnect(selectedClientId);
      } else if (connectionMode === "waha") {
        await disconnectWahaAction({
          serverUrl: wahaServerUrl,
          apiKey: wahaApiKey,
          sessionName: wahaSessionName,
        });
      } else if (connectionMode === "evolution") {
        await disconnectEvolutionAction({ serverUrl, apiKey, instanceName });
      }
      setConnectionState("close");
      setQrCodeData(null);
      setConnectedPhone(null);
      setSuccessNotice("WhatsApp desconectado com sucesso.");
    } catch (e) {
      setErrorMessage("Erro ao desconectar: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  };

  // Polling automático enquanto aguarda leitura do QR Code
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    let retries = 0;
    const MAX_RETRIES = 20; // para após 60s (20 × 3s)

    if (connectionState === "connecting") {
      interval = setInterval(async () => {
        retries++;
        if (retries > MAX_RETRIES) {
          if (interval) clearInterval(interval);
          setConnectionState("close");
          setQrCodeData(null);
          setErrorMessage("Tempo esgotado aguardando QR Code. Tente novamente.");
          return;
        }

        try {
          if (connectionMode === "native") {
            const res = await nativeStatus(selectedClientId);
            if (res.ok && res.state === "open") {
              setConnectionState("open");
              setQrCodeData(null);
              if (res.phone) setConnectedPhone(res.phone);
              setSuccessNotice("🎉 WhatsApp Conectado com Sucesso!");
            } else if (res.ok && res.qrcode) {
              setQrCodeData(res.qrcode);
            }
          } else if (connectionMode === "waha") {
            if (!wahaServerUrl.trim()) return;
            const res = await getWahaStatusAction({
              serverUrl: wahaServerUrl,
              apiKey: wahaApiKey,
              sessionName: wahaSessionName,
            });
            if (res.ok && res.state === "open") {
              setConnectionState("open");
              setQrCodeData(null);
              if (res.phone) setConnectedPhone(res.phone);
              setSuccessNotice("🎉 WhatsApp Conectado com Sucesso via WAHA!");
            } else if (res.ok && res.qrcode) {
              setQrCodeData(res.qrcode);
              retries = 0; // tem QR, zera o contador
            } else if (!res.ok) {
              // erro real, para o polling
              if (interval) clearInterval(interval);
              setConnectionState("close");
              setQrCodeData(null);
              if (res.error) setErrorMessage(res.error);
            }
          } else if (connectionMode === "evolution") {
            if (!serverUrl.trim()) return;
            const res = await getEvolutionStatusAction({ serverUrl, apiKey, instanceName });
            if (res.ok && res.state === "open") {
              setConnectionState("open");
              setQrCodeData(null);
              if (res.phone) setConnectedPhone(res.phone);
              setSuccessNotice("🎉 WhatsApp Conectado com Sucesso via Evolution API!");
            }
          }
        } catch {
          // segue polling
        }
      }, 3000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [connectionState, connectionMode, selectedClientId, serverUrl, apiKey, instanceName, wahaServerUrl, wahaApiKey, wahaSessionName]);

  // Checa status inicial ao trocar cliente ou modo
  useEffect(() => {
    checkStatus();
  }, [selectedClientId, connectionMode, wahaServerUrl]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", maxWidth: "1020px" }}>
      {/* Cabeçalho */}
      <div className="page-head" style={{ marginBottom: "0" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 800 }}>Conectar WhatsApp</h1>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                padding: "3px 9px",
                borderRadius: "999px",
                background: "linear-gradient(90deg, rgba(52, 199, 123, 0.2), rgba(0, 242, 254, 0.2))",
                color: "#34c77b",
                border: "1px solid rgba(52, 199, 123, 0.4)",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <Zap size={12} />
              BAILEYS NATIVO + WAHA + EVOLUTION
            </span>
          </div>
          <p className="muted small" style={{ margin: "4px 0 0 0" }}>
            Conecte seu WhatsApp para capturar automaticamente cliques em anúncios Click-to-WhatsApp, <code>ctwa_clid</code> e novas mensagens.
          </p>
        </div>
      </div>

      {/* Seletor de Modo (3 Abas) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "10px" }}>
        <button
          type="button"
          onClick={() => changeConnectionMode("native")}
          style={{
            padding: "14px 16px",
            borderRadius: "10px",
            border: connectionMode === "native" ? "2px solid #34c77b" : "2px solid var(--border)",
            background: connectionMode === "native" ? "rgba(52, 199, 123, 0.12)" : "var(--surface)",
            color: connectionMode === "native" ? "#34c77b" : "var(--text-muted)",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: "13px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            transition: "all 0.2s",
            textAlign: "left",
          }}
        >
          <Radio size={18} />
          <div>
            <div style={{ fontWeight: 700, color: connectionMode === "native" ? "#ffffff" : "var(--text)" }}>
              WhatsApp Direto (Nativo)
            </div>
            <div style={{ fontSize: "11px", fontWeight: 400, opacity: 0.85, marginTop: "2px" }}>
              Zero instalação. Roda direto aqui com Baileys e reconexão automática.
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => changeConnectionMode("waha")}
          style={{
            padding: "14px 16px",
            borderRadius: "10px",
            border: connectionMode === "waha" ? "2px solid #7b39fc" : "2px solid var(--border)",
            background: connectionMode === "waha" ? "rgba(123, 57, 252, 0.12)" : "var(--surface)",
            color: connectionMode === "waha" ? "#b394ff" : "var(--text-muted)",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: "13px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            transition: "all 0.2s",
            textAlign: "left",
          }}
        >
          <Box size={18} />
          <div>
            <div style={{ fontWeight: 700, color: connectionMode === "waha" ? "#ffffff" : "var(--text)" }}>
              WAHA (Docker / VPS)
            </div>
            <div style={{ fontSize: "11px", fontWeight: 400, opacity: 0.85, marginTop: "2px" }}>
              WhatsApp HTTP API. Conexão direta via REST com QR Code e Webhook.
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => changeConnectionMode("evolution")}
          style={{
            padding: "14px 16px",
            borderRadius: "10px",
            border: connectionMode === "evolution" ? "2px solid #38bdf8" : "2px solid var(--border)",
            background: connectionMode === "evolution" ? "rgba(56, 189, 248, 0.12)" : "var(--surface)",
            color: connectionMode === "evolution" ? "#38bdf8" : "var(--text-muted)",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: "13px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            transition: "all 0.2s",
            textAlign: "left",
          }}
        >
          <Server size={18} />
          <div>
            <div style={{ fontWeight: 700, color: connectionMode === "evolution" ? "#ffffff" : "var(--text)" }}>
              Evolution API (Servidor)
            </div>
            <div style={{ fontSize: "11px", fontWeight: 400, opacity: 0.85, marginTop: "2px" }}>
              Para instâncias da Evolution API v1 ou v2 rodando em VPS.
            </div>
          </div>
        </button>
      </div>

      {errorMessage && (
        <div className="note note-err" style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: "2px" }} />
          <span>{errorMessage}</span>
        </div>
      )}

      {successNotice && (
        <div className="note note-ok" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
          <span>{successNotice}</span>
        </div>
      )}

      {connectionMode === "waha" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Card de Configuração e Chaves WAHA */}
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
              <div>
                <h2 style={{ fontSize: "16px", margin: "0 0 4px 0", display: "flex", alignItems: "center", gap: "8px" }}>
                  <Box size={18} color="#7b39fc" />
                  Painel e Configuração do WAHA
                </h2>
                <p className="muted small" style={{ margin: 0 }}>
                  Conecte o motor WAHA (embutido no sistema ou em container externo) para gerenciar tudo em tempo real.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setWahaServerUrl(`${origin}/api/waha`)}
                style={{
                  background: "rgba(123, 57, 252, 0.15)",
                  border: "1px solid rgba(123, 57, 252, 0.4)",
                  color: "#b394ff",
                  fontSize: "12px",
                  fontWeight: 700,
                  padding: "6px 14px",
                  borderRadius: "8px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <Zap size={14} />
                ⚡ Usar WAHA Embutido no Sistema
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "14px" }}>
              <div>
                <label htmlFor="client_id_waha" style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: 600 }}>
                  Cliente do Painel
                </label>
                <select
                  id="client_id_waha"
                  value={selectedClientId}
                  onChange={(e) => handleClientSelect(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    fontSize: "13px",
                  }}
                >
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="waha_server_url_main" style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: 600 }}>
                  Endereço da API do WAHA
                </label>
                <input
                  id="waha_server_url_main"
                  type="text"
                  value={wahaServerUrl}
                  onChange={(e) => setWahaServerUrl(e.target.value)}
                  placeholder={`Ex: ${origin}/api/waha ou http://seu-ip:3000`}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    fontSize: "13px",
                  }}
                />
              </div>

              <div>
                <label htmlFor="waha_session_name_main" style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: 600 }}>
                  Nome da Sessão
                </label>
                <input
                  id="waha_session_name_main"
                  type="text"
                  value={wahaSessionName}
                  onChange={(e) => setWahaSessionName(e.target.value)}
                  placeholder="default"
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    fontSize: "13px",
                  }}
                />
              </div>

              <div>
                <label htmlFor="waha_api_key_main" style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: 600 }}>
                  Chave API (Opcional)
                </label>
                <input
                  id="waha_api_key_main"
                  type="password"
                  value={wahaApiKey}
                  onChange={(e) => setWahaApiKey(e.target.value)}
                  placeholder="WAHA_API_KEY do .env"
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    fontSize: "13px",
                  }}
                />
              </div>
            </div>
          </div>

          {/* Painel Completo do WAHA com visualização total */}
          <WahaDashboard
            wahaServerUrl={wahaServerUrl}
            wahaSessionName={wahaSessionName}
            wahaApiKey={wahaApiKey}
            clientWebhookKey={currentClient?.webhook_key || ""}
          />
        </div>
      ) : (
        <div className="grid-2">
          {/* Painel Esquerdo: Configurações */}
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <h2 style={{ fontSize: "16px", margin: "0 0 4px 0" }}>
              {connectionMode === "native" && "Configuração Nativa (Sem Servidor)"}
              {connectionMode === "evolution" && "Dados da Instância Evolution API"}
            </h2>

          <div>
            <label htmlFor="client_id" style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: 600 }}>
              Cliente do Painel
            </label>
            <select
              id="client_id"
              value={selectedClientId}
              onChange={(e) => handleClientSelect(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: "8px",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                color: "var(--text)",
                fontSize: "13px",
              }}
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <div className="hint" style={{ marginTop: "4px" }}>
              Os leads que chegarem neste WhatsApp serão vinculados a este cliente.
            </div>
          </div>

          {/* MODO NATIVO */}
          {connectionMode === "native" && (
            <div
              style={{
                padding: "14px",
                borderRadius: "10px",
                background: "rgba(52, 199, 123, 0.06)",
                border: "1px solid rgba(52, 199, 123, 0.2)",
                fontSize: "12px",
                color: "var(--text-muted)",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#34c77b", fontWeight: 600 }}>
                <Zap size={14} />
                <span>Baileys Nativo Integrado (Ativo na VPS)</span>
              </div>
              <p style={{ margin: 0, lineHeight: "1.5" }}>
                O Track Manual executa a conexão WhatsApp diretamente no seu sistema. Não é necessário Docker nem servidores extras.
              </p>
              <ul style={{ margin: "4px 0 0 0", paddingLeft: "18px", lineHeight: "1.6" }}>
                <li>Reconexão automática em caso de queda de rede</li>
                <li>Extração de <code>ctwa_clid</code> de anúncios Meta Click-to-WhatsApp</li>
                <li>Sessão persistida com segurança no disco</li>
              </ul>
              {connectedPhone && (
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px", color: "#34c77b", fontWeight: 600 }}>
                  <CheckCircle2 size={13} />
                  Número conectado: +{connectedPhone}
                </div>
              )}
            </div>
          )}

          {/* MODO WAHA */}
          {connectionMode === "waha" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                  <label htmlFor="waha_server_url" style={{ fontSize: "13px", fontWeight: 600 }}>
                    Endereço da API do WAHA
                  </label>
                  <button
                    type="button"
                    onClick={() => setWahaServerUrl(`${origin}/api/waha`)}
                    style={{
                      background: "rgba(123, 57, 252, 0.15)",
                      border: "1px solid rgba(123, 57, 252, 0.4)",
                      color: "#b394ff",
                      fontSize: "11px",
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: "6px",
                      cursor: "pointer",
                    }}
                  >
                    ⚡ Usar WAHA Embutido no Sistema
                  </button>
                </div>
                <input
                  id="waha_server_url"
                  type="text"
                  value={wahaServerUrl}
                  onChange={(e) => setWahaServerUrl(e.target.value)}
                  placeholder={`Ex: ${origin}/api/waha ou http://seu-ip:3000`}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    fontSize: "13px",
                  }}
                />
                <div className="hint" style={{ marginTop: "4px" }}>
                  Clique no botão <strong>&quot;Usar WAHA Embutido&quot;</strong> acima para rodar sem precisar de Docker ou VPS externa!
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <div>
                  <label htmlFor="waha_session_name" style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: 600 }}>
                    Nome da Sessão
                  </label>
                  <input
                    id="waha_session_name"
                    type="text"
                    value={wahaSessionName}
                    onChange={(e) => setWahaSessionName(e.target.value)}
                    placeholder="default"
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                      fontSize: "13px",
                    }}
                  />
                </div>
                <div>
                  <label htmlFor="waha_api_key" style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: 600 }}>
                    Chave API (Opcional)
                  </label>
                  <input
                    id="waha_api_key"
                    type="password"
                    value={wahaApiKey}
                    onChange={(e) => setWahaApiKey(e.target.value)}
                    placeholder="WAHA_API_KEY do .env"
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                      fontSize: "13px",
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: 600 }}>
                  Webhook URL do Track Manual no WAHA (Evento <code>message</code>)
                </label>
                <div style={{ display: "flex", gap: "6px" }}>
                  <input
                    type="text"
                    readOnly
                    value={wahaWebhookUrl}
                    style={{
                      flex: 1,
                      padding: "8px 12px",
                      borderRadius: "8px",
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      color: "#34c77b",
                      fontSize: "11px",
                      fontFamily: "monospace",
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(wahaWebhookUrl, "webhook")}
                  >
                    {copiedField === "webhook" ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                    {copiedField === "webhook" ? "Copiado!" : "Copiar"}
                  </Button>
                </div>
                <div className="hint" style={{ marginTop: "4px" }}>
                  Ao clicar em <strong>Gerar QR Code</strong>, o Track Manual registra esse webhook automaticamente no WAHA!
                </div>
              </div>

              <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={testWahaWebhook}
                  disabled={wahaTesting}
                  style={{ flex: 1 }}
                >
                  {wahaTesting ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  Testar Endpoint do Webhook
                </Button>
              </div>

              {wahaTestResult && (
                <div style={{ fontSize: "12px", padding: "8px 12px", borderRadius: "6px", background: "var(--surface)", border: "1px solid var(--border)" }}>
                  {wahaTestResult}
                </div>
              )}
            </div>
          )}

          {/* MODO EVOLUTION */}
          {connectionMode === "evolution" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <label htmlFor="instance_name" style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: 600 }}>
                  Nome da Instância
                </label>
                <input
                  id="instance_name"
                  type="text"
                  value={instanceName}
                  onChange={(e) => setInstanceName(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    fontSize: "13px",
                  }}
                />
                <div className="hint" style={{ marginTop: "4px" }}>
                  Identificador único da sessão na Evolution API.
                </div>
              </div>

              <div>
                <label htmlFor="server_url" style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: 600 }}>
                  Endereço da Evolution API
                </label>
                <input
                  id="server_url"
                  type="text"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="Ex: http://seu-ip:8080 ou https://evolution.seudominio.com"
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    fontSize: "13px",
                  }}
                />
                <div className="hint" style={{ marginTop: "4px" }}>
                  Endereço completo da VPS onde a Evolution API está em execução.
                </div>
              </div>

              <div>
                <label htmlFor="api_key" style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: 600 }}>
                  Chave Global da Evolution (API Key)
                </label>
                <input
                  id="api_key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="AUTHENTICATION_API_KEY do .env"
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    fontSize: "13px",
                  }}
                />
                <div className="hint" style={{ marginTop: "4px" }}>
                  Definida na variável AUTHENTICATION_API_KEY no .env da Evolution API.
                </div>
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={checkStatus}
              disabled={checking || loading}
              style={{ flex: 1 }}
            >
              <RefreshCw size={14} className={checking ? "animate-spin" : undefined} />
              Verificar Conexão
            </Button>
          </div>
        </div>

        {/* Painel Direito: Status e QR Code */}
        <div
          className="card"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "32px 24px",
            textAlign: "center",
            minHeight: "380px",
            border: connectionState === "open" ? "1px solid rgba(52, 199, 123, 0.4)" : undefined,
            background:
              connectionState === "open"
                ? "linear-gradient(145deg, rgba(52, 199, 123, 0.08), rgba(21, 18, 29, 0.95))"
                : undefined,
          }}
        >
          {/* ESTADO 1: Conectado (Nativo, WAHA ou Evolution) */}
          {connectionState === "open" && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "14px" }}>
              <div
                style={{
                  width: "72px",
                  height: "72px",
                  borderRadius: "50%",
                  background: "rgba(52, 199, 123, 0.15)",
                  color: "#34c77b",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 0 25px rgba(52, 199, 123, 0.3)",
                }}
              >
                <CheckCircle2 size={40} />
              </div>
              <div>
                <h3 style={{ margin: "0 0 6px 0", fontSize: "18px", color: "#34c77b", fontWeight: 800 }}>
                  WhatsApp Conectado!
                </h3>
                <p className="muted small" style={{ margin: 0, maxWidth: "340px" }}>
                  {connectedPhone ? `Número +${connectedPhone} conectado.` : "WhatsApp ativo."} Todos os cliques em anúncios e conversas são capturados com <code>ctwa_clid</code> automaticamente.
                </p>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 16px",
                  borderRadius: "8px",
                  background: "rgba(52, 199, 123, 0.1)",
                  fontSize: "12px",
                  color: "#34c77b",
                  fontWeight: 600,
                  marginTop: "6px",
                }}
              >
                <ShieldCheck size={16} />
                <span>Receptor Inteligente Ativo ({connectionMode.toUpperCase()})</span>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDisconnect}
                disabled={loading}
                style={{ marginTop: "14px" }}
              >
                <LogOut size={14} />
                Desconectar WhatsApp
              </Button>
            </div>
          )}

          {/* ESTADO 2: Aguardando Escaneamento (QR Code) */}
          {connectionState === "connecting" && qrCodeData && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
              <div
                style={{
                  padding: "16px",
                  background: "#ffffff",
                  borderRadius: "12px",
                  boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5)",
                }}
              >
                <img
                  src={qrCodeData.startsWith("data:") ? qrCodeData : `data:image/png;base64,${qrCodeData}`}
                  alt="QR Code WhatsApp"
                  style={{ width: "220px", height: "220px", display: "block" }}
                />
              </div>
              <div>
                <h3 style={{ margin: "0 0 6px 0", fontSize: "16px", fontWeight: 700 }}>
                  Escaneie o QR Code no seu WhatsApp
                </h3>
                <ol
                  style={{
                    textAlign: "left",
                    fontSize: "12px",
                    color: "var(--text-muted)",
                    paddingLeft: "20px",
                    margin: "0 0 10px 0",
                    lineHeight: "1.6",
                  }}
                >
                  <li>Abra o WhatsApp no celular</li>
                  <li>
                    Toque em <strong>Configurações</strong> &gt; <strong>Aparelhos Conectados</strong>
                  </li>
                  <li>
                    Toque em <strong>Conectar um Aparelho</strong> e aponte para a tela
                  </li>
                </ol>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "#b394ff" }}>
                <Loader2 size={14} className="animate-spin" />
                <span>Aguardando leitura do QR Code pelo celular…</span>
              </div>
            </div>
          )}

          {/* ESTADO 3: Carregando QR Code */}
          {connectionState === "connecting" && !qrCodeData && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "14px" }}>
              <Loader2 size={36} className="animate-spin" style={{ color: "#b394ff" }} />
              <p className="muted small">Gerando QR Code na VPS, aguarde…</p>
            </div>
          )}

          {/* ESTADO 4: Desconectado / Inicial */}
          {connectionState !== "open" && connectionState !== "connecting" && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
              <div
                style={{
                  width: "68px",
                  height: "68px",
                  borderRadius: "50%",
                  background:
                    connectionMode === "native"
                      ? "rgba(52, 199, 123, 0.15)"
                      : connectionMode === "waha"
                        ? "rgba(123, 57, 252, 0.15)"
                        : "rgba(56, 189, 248, 0.15)",
                  color:
                    connectionMode === "native"
                      ? "#34c77b"
                      : connectionMode === "waha"
                        ? "#b394ff"
                        : "#38bdf8",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {connectionMode === "native" && <Smartphone size={34} />}
                {connectionMode === "waha" && <Box size={34} />}
                {connectionMode === "evolution" && <Server size={34} />}
              </div>
              <div>
                <h3 style={{ margin: "0 0 6px 0", fontSize: "17px", fontWeight: 700 }}>
                  Nenhum WhatsApp Conectado
                </h3>
                <p className="muted small" style={{ margin: 0, maxWidth: "340px" }}>
                  {connectionMode === "native"
                    ? "Gere o QR Code para conectar seu número de WhatsApp diretamente ao Track Manual."
                    : connectionMode === "waha"
                      ? "Gere o QR Code para conectar a sessão WAHA ao seu WhatsApp."
                      : "Gere o QR Code para conectar a instância Evolution API ao seu WhatsApp."}
                </p>
              </div>
              <Button
                size="default"
                onClick={handleConnect}
                disabled={loading}
                style={{
                  background:
                    connectionMode === "native"
                      ? "linear-gradient(90deg, #34c77b 0%, #00f2fe 100%)"
                      : connectionMode === "waha"
                        ? "linear-gradient(90deg, #7b39fc 0%, #34c77b 100%)"
                        : "linear-gradient(90deg, #38bdf8 0%, #7b39fc 100%)",
                  color: "#ffffff",
                  fontWeight: 700,
                  boxShadow: "0 4px 15px rgba(0, 0, 0, 0.3)",
                  padding: "10px 24px",
                }}
              >
                {loading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Gerando QR Code…
                  </>
                ) : (
                  <>
                    <QrCode size={16} />
                    Gerar QR Code para Conectar
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      </div>
      )}

      {/* Dicas e Como Funciona */}
      <div className="card" style={{ padding: "20px" }}>
        <h3 style={{ fontSize: "15px", margin: "0 0 12px 0", display: "flex", alignItems: "center", gap: "8px" }}>
          <Sparkles size={16} style={{ color: "#7b39fc" }} />
          Como o rastreamento automático funciona:
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "14px" }}>
          {[
            {
              n: "1",
              title: "Clique no Anúncio (Meta)",
              text: "O cliente clica no anúncio no Instagram ou Facebook e o Meta anexa o ctwa_clid e o ID do anúncio.",
              color: "#ebe8f2",
            },
            {
              n: "2",
              title: "Chegada no WhatsApp (VPS)",
              text: "O Track Manual (Nativo, WAHA ou Evolution) recebe a mensagem com os dados do criativo e clid automaticamente.",
              color: "#ebe8f2",
            },
            {
              n: "3",
              title: "Venda e Atribuição Perfeita",
              text: "O lead é enriquecido na hora. Ao comprar, a conversão é enviada para a campanha exata do anúncio!",
              color: "#34c77b",
            },
          ].map(({ n, title, text, color }) => (
            <div key={n} style={{ padding: "12px", borderRadius: "8px", background: "var(--surface)", border: "1px solid var(--border)" }}>
              <strong style={{ color, fontSize: "13px", display: "block", marginBottom: "4px" }}>
                {n}. {title}
              </strong>
              <p className="muted small" style={{ margin: 0 }}>
                {text}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
