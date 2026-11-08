"use client";

import { useState, useRef } from "react";
import {
  Bell,
  CheckCircle2,
  Clock,
  Database,
  DollarSign,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserCheck,
  Volume2,
  Zap,
} from "lucide-react";
import {
  autoRecoverLeadNamesAction,
  executeMediaCleanupAction,
  saveSystemSettingsAction,
} from "@/app/actions";
import { Button } from "@/components/ui/button";

interface SystemSettingsFormProps {
  initialSettings: {
    auto_cleanup_media?: string;
    auto_cleanup_days?: string;
    sound_notifications?: string;
    tab_badge_notifications?: string;
    currency_format?: string;
    attribution_window_days?: string;
    system_favicon_url?: string;
  };
}

// Presets pré-construídos de Favicon em SVG moderno
const FAVICON_PRESETS = [
  {
    name: "Radar Meta (Padrão)",
    value: "/favicon.svg",
    previewSvg: (
      <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
        <rect width="32" height="32" rx="8" fill="#0d0a1e" />
        <circle cx="16" cy="16" r="11" stroke="#7b39fc" strokeWidth="2.5" opacity="0.4" />
        <circle cx="16" cy="16" r="6" stroke="#34c77b" strokeWidth="2.5" />
        <circle cx="16" cy="16" r="2.5" fill="#34c77b" />
      </svg>
    ),
  },
  {
    name: "WhatsApp Conexão",
    value:
      'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="%2325D366"/><path d="M16 6C10.48 6 6 10.48 6 16c0 1.95.56 3.78 1.54 5.33L6.5 25.5l4.34-1.02A9.94 9.94 0 0016 26c5.52 0 10-4.48 10-10S21.52 6 16 6zm4.8 14.15c-.2.57-1.16 1.1-1.63 1.14-.44.04-1 .06-3.23-.86-2.84-1.18-4.66-4.07-4.8-4.26-.14-.2-1.16-1.55-1.16-2.95 0-1.4.73-2.09 1-2.37.24-.26.54-.33.72-.33.18 0 .36 0 .52.01.17.01.39-.06.61.47.23.54.78 1.9.85 2.04.07.14.12.31.02.5-.1.2-.15.31-.3.49-.15.18-.31.4-.44.54-.15.14-.3.3-.13.6.17.29.77 1.27 1.65 2.05 1.13 1.01 2.08 1.32 2.38 1.46.29.15.46.12.63-.07.17-.2.73-.85.92-1.14.2-.29.39-.24.66-.14.26.1 1.68.79 1.97.94.29.15.49.22.56.34.07.12.07.71-.13 1.28z" fill="%23ffffff"/></svg>',
    previewSvg: (
      <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
        <rect width="32" height="32" rx="8" fill="#25D366" />
        <circle cx="16" cy="16" r="6" fill="#ffffff" />
      </svg>
    ),
  },
  {
    name: "Moeda Ouro (Vendas)",
    value:
      'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="%231a1528"/><circle cx="16" cy="16" r="11" fill="%23ffd700"/><circle cx="16" cy="16" r="9" fill="%23e6b800"/><text x="16" y="21" font-size="14" font-weight="900" text-anchor="middle" fill="%231a1528" font-family="sans-serif">$</text></svg>',
    previewSvg: (
      <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
        <rect width="32" height="32" rx="8" fill="#1a1528" />
        <circle cx="16" cy="16" r="9" fill="#ffd700" />
      </svg>
    ),
  },
  {
    name: "Raio Roxo (Conversão)",
    value:
      'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="%237b39fc"/><path d="M17 5L9 17h6l-2 10 9-13h-6l3-9z" fill="%23ffffff"/></svg>',
    previewSvg: (
      <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
        <rect width="32" height="32" rx="8" fill="#7b39fc" />
        <polygon points="14,6 8,16 13,16 11,26 18,14 13,14" fill="#ffffff" />
      </svg>
    ),
  },
];

export function SystemSettingsForm({ initialSettings }: SystemSettingsFormProps) {
  const [autoCleanup, setAutoCleanup] = useState(initialSettings.auto_cleanup_media === "true");
  const [cleanupDays, setCleanupDays] = useState(initialSettings.auto_cleanup_days || "30");
  const [soundEnabled, setSoundEnabled] = useState(initialSettings.sound_notifications !== "false");
  const [badgeEnabled, setBadgeEnabled] = useState(initialSettings.tab_badge_notifications !== "false");
  const [currency, setCurrency] = useState(initialSettings.currency_format || "BRL");
  const [attrWindow, setAttrWindow] = useState(initialSettings.attribution_window_days || "7");
  const [faviconUrl, setFaviconUrl] = useState(initialSettings.system_favicon_url || "/favicon.svg");

  const [saving, setSaving] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; msg: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setNotice({ ok: false, msg: "Selecione um arquivo de imagem válido (PNG, SVG, ICO ou JPG)." });
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setNotice({ ok: false, msg: "A imagem selecionada é muito grande. Escolha uma imagem com até 2MB." });
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (result) {
        setFaviconUrl(result);
        setNotice({
          ok: true,
          msg: "Imagem carregada com sucesso! Clique em 'Salvar Todas as Configurações' abaixo para aplicar o novo Favicon na aba do navegador.",
        });
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const res = await saveSystemSettingsAction({
        auto_cleanup_media: autoCleanup ? "true" : "false",
        auto_cleanup_days: cleanupDays,
        sound_notifications: soundEnabled ? "true" : "false",
        tab_badge_notifications: badgeEnabled ? "true" : "false",
        currency_format: currency,
        attribution_window_days: attrWindow,
        system_favicon_url: faviconUrl,
      });

      // Atualiza o favicon na tag <link rel="icon"> no DOM imediatamente
      if (typeof document !== "undefined") {
        let link: HTMLLinkElement | null = document.querySelector("link[rel*='icon']");
        if (!link) {
          link = document.createElement("link");
          link.rel = "shortcut icon";
          document.head.appendChild(link);
        }
        link.href = faviconUrl;
      }

      setNotice({ ok: res.ok, msg: res.message });
      if (typeof window !== "undefined") {
        localStorage.setItem("track_sound_enabled", soundEnabled ? "true" : "false");
      }
    } catch (err) {
      setNotice({ ok: false, msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleRunCleanupNow = async () => {
    setCleaning(true);
    setNotice(null);
    try {
      const res = await executeMediaCleanupAction(Number(cleanupDays) || 30);
      setNotice({ ok: res.ok, msg: res.message });
    } catch (err) {
      setNotice({ ok: false, msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setCleaning(false);
    }
  };

  const handleRecoverNamesNow = async () => {
    setRecovering(true);
    setNotice(null);
    try {
      const res = await autoRecoverLeadNamesAction();
      setNotice({ ok: res.ok, msg: res.message });
    } catch (err) {
      setNotice({ ok: false, msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setRecovering(false);
    }
  };

  return (
    <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {notice && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: "8px",
            background: notice.ok ? "rgba(52, 199, 123, 0.12)" : "rgba(239, 68, 68, 0.12)",
            border: `1px solid ${notice.ok ? "rgba(52, 199, 123, 0.35)" : "rgba(239, 68, 68, 0.35)"}`,
            color: notice.ok ? "#34c77b" : "#ef4444",
            fontSize: "13px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          {notice.ok && <CheckCircle2 size={16} />}
          <span>{notice.msg}</span>
        </div>
      )}

      {/* Seção 1: Favicon e Identidade Visual da Aba */}
      <div style={{ padding: "18px", borderRadius: "10px", background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px" }}>
              <ImageIcon size={16} style={{ color: "#38bdf8" }} />
              Favicon e Identidade da Aba do Navegador
            </h3>
            <p className="muted small" style={{ margin: "4px 0 0" }}>
              Altere o ícone que aparece na aba do navegador. Você pode selecionar um modelo pronto, carregar uma imagem do seu computador ou colar um link direto.
            </p>
          </div>
        </div>

        {/* Visualizador de Favicon e Preview */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "20px",
            background: "var(--surface-2)",
            padding: "16px",
            borderRadius: "8px",
            border: "1px solid var(--border)",
            marginBottom: "16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "10px",
                background: "#0d0a1e",
                border: "2px solid #7b39fc",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                boxShadow: "0 4px 12px rgba(123, 57, 252, 0.25)",
              }}
            >
              {faviconUrl.startsWith("<svg") ? (
                <div dangerouslySetInnerHTML={{ __html: faviconUrl }} style={{ width: "32px", height: "32px" }} />
              ) : (
                <img src={faviconUrl} alt="Favicon Preview" style={{ width: "32px", height: "32px", objectFit: "contain" }} />
              )}
            </div>

            <div>
              <div style={{ fontSize: "13px", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
                <span>Pré-visualização do Favicon</span>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 800,
                    padding: "2px 6px",
                    borderRadius: "4px",
                    background: "rgba(56, 189, 248, 0.2)",
                    color: "#38bdf8",
                  }}
                >
                  AO VIVO
                </span>
              </div>
              <div className="muted small">Este é o ícone exibido na aba e nos favoritos do navegador.</div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginLeft: "auto" }}>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept="image/png,image/svg+xml,image/x-icon,image/jpeg,image/webp"
              style={{ display: "none" }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              style={{ borderColor: "rgba(56, 189, 248, 0.4)", color: "#38bdf8", background: "rgba(56, 189, 248, 0.08)" }}
            >
              <Upload size={14} />
              Carregar Imagem do Computador
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setFaviconUrl("/favicon.svg")}
              title="Restaurar para o Favicon padrão"
            >
              <RotateCcw size={14} />
              Restaurar Padrão
            </Button>
          </div>
        </div>

        {/* Presets Rápidos */}
        <div style={{ marginBottom: "14px" }}>
          <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "8px", fontWeight: 600 }}>
            Modelos Rápidos Pré-Definidos:
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
            {FAVICON_PRESETS.map((p) => {
              const isSelected = faviconUrl === p.value;
              return (
                <button
                  type="button"
                  key={p.name}
                  onClick={() => setFaviconUrl(p.value)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "6px 12px",
                    borderRadius: "8px",
                    background: isSelected ? "rgba(123, 57, 252, 0.25)" : "var(--surface-2)",
                    border: `1px solid ${isSelected ? "#7b39fc" : "var(--border)"}`,
                    color: isSelected ? "#fff" : "var(--text)",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  {p.previewSvg}
                  <span>{p.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Input Manual de URL */}
        <div>
          <label style={{ display: "block", fontSize: "12px", color: "var(--text-muted)", marginBottom: "6px" }}>
            Ou cole o link direto (URL ou Data-URI) do ícone:
          </label>
          <input
            type="text"
            value={faviconUrl}
            onChange={(e) => setFaviconUrl(e.target.value)}
            placeholder="https://exemplo.com/meu-favicon.ico ou /favicon.svg"
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: "6px",
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              fontSize: "13px",
              fontFamily: "monospace",
            }}
          />
        </div>
      </div>

      {/* Seção 2: Identificação de Contatos & Recuperação de Nomes */}
      <div style={{ padding: "18px", borderRadius: "10px", background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px" }}>
              <UserCheck size={16} style={{ color: "#34c77b" }} />
              Identificação de Contatos e Nomes do WhatsApp
            </h3>
            <p className="muted small" style={{ margin: "4px 0 0" }}>
              Recupera automaticamente o nome e pushName dos contatos que constam como &quot;Sem Nome&quot; através dos metadados recebidos pelo WhatsApp.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRecoverNamesNow}
            disabled={recovering}
            style={{
              borderColor: "rgba(52, 199, 123, 0.4)",
              color: "#34c77b",
              background: "rgba(52, 199, 123, 0.08)",
            }}
          >
            {recovering ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {recovering ? "Sincronizando..." : "Recuperar Nomes dos Contatos"}
          </Button>
        </div>
      </div>

      {/* Seção 3: Otimização de Armazenamento & Auto-Limpeza */}
      <div style={{ padding: "18px", borderRadius: "10px", background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px" }}>
              <Trash2 size={16} style={{ color: "#b394ff" }} />
              Auto-Limpeza de Mídias e Otimização do Banco
            </h3>
            <p className="muted small" style={{ margin: "4px 0 0" }}>
              Remove arquivos de fotos e mídias pesadas antigas arquivadas para manter o banco leve e rápido, preservando 100% das mensagens de texto.
            </p>
          </div>
          <label style={{ display: "flex", alignItems: "center", cursor: "pointer", gap: "8px" }}>
            <input
              type="checkbox"
              checked={autoCleanup}
              onChange={(e) => setAutoCleanup(e.target.checked)}
              style={{ width: "18px", height: "18px", accentColor: "#7b39fc", cursor: "pointer" }}
            />
            <span style={{ fontSize: "13px", fontWeight: 700, color: autoCleanup ? "#34c77b" : "var(--text-muted)" }}>
              {autoCleanup ? "Ativada" : "Desativada"}
            </span>
          </label>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "14px", marginTop: "12px", borderTop: "1px solid var(--border)", paddingTop: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
            <span style={{ color: "var(--text-muted)" }}>Limpar mídias com mais de:</span>
            <select
              value={cleanupDays}
              onChange={(e) => setCleanupDays(e.target.value)}
              disabled={!autoCleanup}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                color: "var(--text)",
                fontSize: "13px",
              }}
            >
              <option value="7">7 dias (Mais agressivo)</option>
              <option value="15">15 dias</option>
              <option value="30">30 dias (Recomendado)</option>
              <option value="60">60 dias</option>
              <option value="90">90 dias</option>
            </select>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRunCleanupNow}
            disabled={cleaning}
            style={{
              marginLeft: "auto",
              borderColor: "rgba(123, 57, 252, 0.4)",
              color: "#b394ff",
              background: "rgba(123, 57, 252, 0.08)",
            }}
          >
            {cleaning ? <Loader2 size={13} className="animate-spin" /> : <Database size={13} />}
            {cleaning ? "Otimizando banco..." : "Executar Limpeza Imediata Agora"}
          </Button>
        </div>
      </div>

      {/* Seção 4: Notificações do Inbox */}
      <div style={{ padding: "18px", borderRadius: "10px", background: "var(--surface)", border: "1px solid var(--border)" }}>
        <h3 style={{ margin: "0 0 14px", fontSize: "15px", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px" }}>
          <Bell size={16} style={{ color: "#34c77b" }} />
          Notificações e Alertas do WhatsApp
        </h3>

        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Volume2 size={16} style={{ color: soundEnabled ? "#34c77b" : "var(--text-muted)" }} />
              <div>
                <div style={{ fontSize: "13px", fontWeight: 600 }}>Som de Alerta ao Receber Mensagem</div>
                <div className="muted small">Toca um alerta sonoro suave estilo WhatsApp quando um novo lead mandar mensagem.</div>
              </div>
            </div>
            <input
              type="checkbox"
              checked={soundEnabled}
              onChange={(e) => setSoundEnabled(e.target.checked)}
              style={{ width: "18px", height: "18px", accentColor: "#34c77b", cursor: "pointer" }}
            />
          </label>

          <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", borderTop: "1px solid var(--border)", paddingTop: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Sparkles size={16} style={{ color: badgeEnabled ? "#38bdf8" : "var(--text-muted)" }} />
              <div>
                <div style={{ fontSize: "13px", fontWeight: 600 }}>Alerta Visual no Título da Aba</div>
                <div className="muted small">Altera o título do navegador para &quot;💬 Nova Mensagem | Track Manual&quot; quando a aba estiver em segundo plano.</div>
              </div>
            </div>
            <input
              type="checkbox"
              checked={badgeEnabled}
              onChange={(e) => setBadgeEnabled(e.target.checked)}
              style={{ width: "18px", height: "18px", accentColor: "#38bdf8", cursor: "pointer" }}
            />
          </label>
        </div>
      </div>

      {/* Seção 5: Preferências de Moeda e Janela de Atribuição */}
      <div style={{ padding: "18px", borderRadius: "10px", background: "var(--surface)", border: "1px solid var(--border)" }}>
        <h3 style={{ margin: "0 0 14px", fontSize: "15px", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px" }}>
          <DollarSign size={16} style={{ color: "#ffd700" }} />
          Moeda e Janela de Atribuição CAPI
        </h3>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "16px" }}>
          <div>
            <label style={{ display: "block", fontSize: "12px", color: "var(--text-muted)", marginBottom: "6px" }}>
              Moeda Padrão de Exibição
            </label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: "6px",
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                color: "var(--text)",
                fontSize: "13px",
              }}
            >
              <option value="BRL">Real Brasileiro (R$ BRL)</option>
              <option value="USD">Dólar Americano ($ USD)</option>
              <option value="EUR">Euro (€ EUR)</option>
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "12px", color: "var(--text-muted)", marginBottom: "6px" }}>
              Janela de Atribuição Last-Click
            </label>
            <select
              value={attrWindow}
              onChange={(e) => setAttrWindow(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: "6px",
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                color: "var(--text)",
                fontSize: "13px",
              }}
            >
              <option value="7">7 dias pós-clique (Padrão Meta Ads)</option>
              <option value="14">14 dias pós-clique</option>
              <option value="28">28 dias pós-clique (Janela Estendida)</option>
            </select>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button
          type="submit"
          disabled={saving}
          style={{
            background: "linear-gradient(90deg, #7b39fc 0%, #34c77b 100%)",
            color: "#fff",
            fontWeight: 700,
            gap: "6px",
            padding: "10px 20px",
          }}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Salvar Todas as Configurações
        </Button>
      </div>
    </form>
  );
}
