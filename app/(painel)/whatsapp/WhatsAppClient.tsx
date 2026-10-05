"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Info,
  Loader2,
  LogOut,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Zap,
} from "lucide-react";
import {
  connectEvolutionAction,
  disconnectEvolutionAction,
  getEvolutionStatusAction,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import type { Client } from "@/lib/types";

interface WhatsAppClientProps {
  clients: Client[];
}

export function WhatsAppClient({ clients }: WhatsAppClientProps) {
  const [selectedClientId, setSelectedClientId] = useState(clients[0]?.id || "");
  const [serverUrl, setServerUrl] = useState("http://localhost:8080");
  const [apiKey, setApiKey] = useState("429683C4C977415CAAFCCE10F7D57E11");
  const [instanceName, setInstanceName] = useState(
    clients[0] ? `track_${clients[0].name.toLowerCase().replace(/\W+/g, "_")}` : "track_whats"
  );

  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [connectionState, setConnectionState] = useState<"close" | "connecting" | "open" | "unknown">("unknown");
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const selectedClient = clients.find((c) => c.id === selectedClientId);

  // Troca de cliente atualiza o nome padrão da instância
  const handleClientSelect = (cId: string) => {
    setSelectedClientId(cId);
    const cl = clients.find((c) => c.id === cId);
    if (cl) {
      setInstanceName(`track_${cl.name.toLowerCase().replace(/\W+/g, "_")}`);
    }
  };

  // Checa status da conexão
  const checkStatus = async () => {
    if (!serverUrl || !apiKey || !instanceName) return;
    setChecking(true);
    setErrorMessage(null);
    try {
      const res = await getEvolutionStatusAction({
        serverUrl,
        apiKey,
        instanceName,
      });
      if (res.ok) {
        if (res.state === "open") {
          setConnectionState("open");
          setQrCodeData(null);
        } else if (res.state === "connecting") {
          setConnectionState("connecting");
        } else {
          setConnectionState("close");
        }
      } else {
        setConnectionState("close");
      }
    } catch (e) {
      setConnectionState("close");
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
          setSuccessNotice("WhatsApp já está conectado e pronto para rastreamento!");
        } else {
          setConnectionState("connecting");
          if (res.qrcode) {
            setQrCodeData(res.qrcode);
          }
        }
      } else {
        setErrorMessage(
          res.error ||
            "Não foi possível conectar à Evolution API. Verifique se ela está ligada em " + serverUrl
        );
      }
    } catch (e) {
      setErrorMessage(
        "Falha ao comunicar com a Evolution API: " + (e instanceof Error ? e.message : String(e))
      );
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
      await disconnectEvolutionAction({
        serverUrl,
        apiKey,
        instanceName,
      });
      setConnectionState("close");
      setQrCodeData(null);
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
    if (connectionState === "connecting") {
      interval = setInterval(async () => {
        try {
          const res = await getEvolutionStatusAction({
            serverUrl,
            apiKey,
            instanceName,
          });
          if (res.ok && res.state === "open") {
            setConnectionState("open");
            setQrCodeData(null);
            setSuccessNotice("🎉 WhatsApp Conectado com Sucesso!");
          }
        } catch {
          // segue polling
        }
      }, 3000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [connectionState, serverUrl, apiKey, instanceName]);

  // Checa status inicial ao carregar a página
  useEffect(() => {
    checkStatus();
  }, [instanceName]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", maxWidth: "980px" }}>
      {/* Cabeçalho */}
      <div className="page-head" style={{ marginBottom: "0" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 800 }}>Conectar WhatsApp (Evolution API)</h1>
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
              BAILEYS NÃO-OFICIAL
            </span>
          </div>
          <p className="muted small" style={{ margin: "4px 0 0 0" }}>
            Conecte seu WhatsApp escaneando o QR Code para capturar automaticamente cliques em anúncios, <code>ctwa_clid</code> e novas conversas.
          </p>
        </div>
      </div>

      {errorMessage && (
        <div className="note note-err" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <AlertCircle size={16} style={{ flexShrink: 0 }} />
          <span>{errorMessage}</span>
        </div>
      )}

      {successNotice && (
        <div className="note note-ok" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
          <span>{successNotice}</span>
        </div>
      )}

      <div className="grid-2">
        {/* Painel Esquerdo: Configurações da Conexão */}
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <h2 style={{ fontSize: "16px", margin: "0 0 4px 0" }}>Dados da Instância</h2>

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
              placeholder="http://localhost:8080"
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
              Porta padrão: 8080. Se estiver em uma VPS, coloque a URL completa.
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
              placeholder="AUTHENTICATION_API_KEY do arquivo .env"
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
          {/* ESTADO 1: Conectado */}
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
                  A instância <strong>{instanceName}</strong> está conectada e escutando. Todos os cliques em anúncios e conversas são capturados com <code>ctwa_clid</code> automaticamente.
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
                <span>Receptor Inteligente Ativo</span>
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

          {/* ESTADO 2: Aguardando Escaneamento (QR Code Gerado) */}
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
                  <li>Toque em <strong>Configurações</strong> &gt; <strong>Aparelhos Conectados</strong></li>
                  <li>Toque em <strong>Conectar um Aparelho</strong> e aponte para a tela</li>
                </ol>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "#b394ff" }}>
                <Loader2 size={14} className="animate-spin" />
                <span>Aguardando leitura do QR Code pelo celular…</span>
              </div>
            </div>
          )}

          {/* ESTADO 3: Desconectado / Inicial */}
          {connectionState !== "open" && !(connectionState === "connecting" && qrCodeData) && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
              <div
                style={{
                  width: "68px",
                  height: "68px",
                  borderRadius: "50%",
                  background: "rgba(123, 57, 252, 0.15)",
                  color: "#b394ff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Smartphone size={34} />
              </div>

              <div>
                <h3 style={{ margin: "0 0 6px 0", fontSize: "17px", fontWeight: 700 }}>
                  Nenhum WhatsApp Conectado
                </h3>
                <p className="muted small" style={{ margin: 0, maxWidth: "340px" }}>
                  Gere o QR Code para conectar seu número de WhatsApp do anúncio ao Track Manual.
                </p>
              </div>

              <Button
                size="default"
                onClick={handleConnect}
                disabled={loading}
                style={{
                  background: "linear-gradient(90deg, #7b39fc 0%, #34c77b 100%)",
                  color: "#ffffff",
                  fontWeight: 700,
                  boxShadow: "0 4px 15px rgba(123, 57, 252, 0.4)",
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

      {/* Dicas e Instruções Passo a Passo */}
      <div className="card" style={{ padding: "20px" }}>
        <h3 style={{ fontSize: "15px", margin: "0 0 12px 0", display: "flex", alignItems: "center", gap: "8px" }}>
          <Sparkles size={16} style={{ color: "#7b39fc" }} />
          Como o rastreamento automático funciona com a Evolution API:
        </h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: "14px",
          }}
        >
          <div style={{ padding: "12px", borderRadius: "8px", background: "var(--surface)", border: "1px solid var(--border)" }}>
            <strong style={{ color: "#ebe8f2", fontSize: "13px", display: "block", marginBottom: "4px" }}>
              1. Clique no Anúncio (Meta)
            </strong>
            <p className="muted small" style={{ margin: 0 }}>
              O cliente clica no anúncio no Instagram ou Facebook e o Meta anexa o <code>ctwa_clid</code> secreto.
            </p>
          </div>

          <div style={{ padding: "12px", borderRadius: "8px", background: "var(--surface)", border: "1px solid var(--border)" }}>
            <strong style={{ color: "#ebe8f2", fontSize: "13px", display: "block", marginBottom: "4px" }}>
              2. Chegada no WhatsApp
            </strong>
            <p className="muted small" style={{ margin: 0 }}>
              A Evolution API recebe a mensagem e repassa o pacote com imagem do criativo e o clique para o Track Manual.
            </p>
          </div>

          <div style={{ padding: "12px", borderRadius: "8px", background: "var(--surface)", border: "1px solid var(--border)" }}>
            <strong style={{ color: "#34c77b", fontSize: "13px", display: "block", marginBottom: "4px" }}>
              3. Venda e Atribuição Perfeita
            </strong>
            <p className="muted small" style={{ margin: 0 }}>
              O lead é salvo na hora. Ao comprar, a conversão é enviada para a campanha exata do anúncio!
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
