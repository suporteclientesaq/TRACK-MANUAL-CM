import { cookies } from "next/headers";
import { isOnline, localPaths, stats, storeKind } from "@/lib/store";
import { THEME_COOKIE, parsePrefs } from "@/lib/theme";
import {
  APP_VERSION,
  APP_RELEASE_NAME,
  APP_BUILD_DATE,
  APP_UPDATE_STATUS,
  APP_CHANGELOG,
} from "@/lib/version";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { ThemeForm } from "./ThemeForm";
import {
  CheckCircle2,
  Database,
  ShieldCheck,
  Sparkles,
  Zap,
  History,
} from "lucide-react";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ salvo?: string }> }) {
  const { salvo } = await searchParams;
  const s = await stats();
  const paths = localPaths();
  const online = isOnline();
  const kind = storeKind();
  const prefs = parsePrefs((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Configurações</h1>
          <p className="muted small">Versão do sistema, aparência, senha e armazenamento dos dados.</p>
        </div>
      </div>

      {salvo && <div className="note note-ok">Senha trocada com sucesso.</div>}

      {/* Card da Versão Atualizada do Sistema */}
      <div className="card" style={{ padding: "24px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", marginBottom: "16px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
              <span
                style={{
                  fontSize: "13px",
                  fontWeight: 700,
                  padding: "4px 12px",
                  borderRadius: "999px",
                  background: "rgba(52, 199, 123, 0.15)",
                  color: "#34c77b",
                  border: "1px solid rgba(52, 199, 123, 0.4)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: "#34c77b",
                    display: "inline-block",
                    boxShadow: "0 0 8px #34c77b",
                  }}
                />
                v{APP_VERSION} ({APP_UPDATE_STATUS})
              </span>
              <span style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: 500 }}>
                Compilação: {APP_BUILD_DATE}
              </span>
            </div>
            <h2 style={{ fontSize: "20px", fontWeight: 800, margin: "0 0 6px 0" }}>{APP_RELEASE_NAME}</h2>
            <p className="muted small" style={{ margin: 0, maxWidth: "620px" }}>
              Plataforma de Rastreamento de Anúncios Click-to-WhatsApp, Atribuição Last-Click multi-campanha (Modelo UTMFY) e Meta Conversions API (CAPI v22.0).
            </p>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 16px",
              borderRadius: "10px",
              background: "rgba(52, 199, 123, 0.1)",
              border: "1px solid rgba(52, 199, 123, 0.3)",
              color: "#34c77b",
              fontSize: "13px",
              fontWeight: 700,
            }}
          >
            <CheckCircle2 size={18} />
            <span>Sistema 100% Atualizado</span>
          </div>
        </div>

        {/* Recursos e Módulos Ativos */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px", marginTop: "18px" }}>
          <div style={{ padding: "14px", borderRadius: "10px", background: "var(--surface)", border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#34c77b", fontSize: "13px", fontWeight: 700, marginBottom: "4px" }}>
              <Zap size={15} />
              Baileys Nativo Integrado
            </div>
            <div className="muted small" style={{ lineHeight: 1.5 }}>
              Conexão direta ao WhatsApp sem servidor externo e com reconexão automática.
            </div>
          </div>

          <div style={{ padding: "14px", borderRadius: "10px", background: "var(--surface)", border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#b394ff", fontSize: "13px", fontWeight: 700, marginBottom: "4px" }}>
              <Sparkles size={15} />
              WAHA & Evolution API
            </div>
            <div className="muted small" style={{ lineHeight: 1.5 }}>
              Compatível com WAHA (Docker/Webhook) e instâncias remotas Evolution API.
            </div>
          </div>

          <div style={{ padding: "14px", borderRadius: "10px", background: "var(--surface)", border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#38bdf8", fontSize: "13px", fontWeight: 700, marginBottom: "4px" }}>
              <ShieldCheck size={15} />
              Extrator CTWA Anti-Perda
            </div>
            <div className="muted small" style={{ lineHeight: 1.5 }}>
              Decodificador Base64 e extrator de tags no texto de mensagens recebidas.
            </div>
          </div>

          <div style={{ padding: "14px", borderRadius: "10px", background: "var(--surface)", border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#f59e0b", fontSize: "13px", fontWeight: 700, marginBottom: "4px" }}>
              <Database size={15} />
              Atribuição & Backup 1-Clique
            </div>
            <div className="muted small" style={{ lineHeight: 1.5 }}>
              Deduplicação Last-Click e download instantâneo de cópia de segurança (.db).
            </div>
          </div>
        </div>

        {/* Histórico das Atualizações Recentes */}
        <div style={{ marginTop: "20px", paddingTop: "16px", borderTop: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px", color: "var(--text)", fontWeight: 700, fontSize: "13px" }}>
            <History size={15} style={{ color: "#b394ff" }} />
            <span>O que há de novo na versão atual (v{APP_VERSION}):</span>
          </div>
          <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "12px", color: "var(--text-muted)", lineHeight: "1.8" }}>
            {APP_CHANGELOG[0].highlights.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="card">
        <h2>Aparência</h2>
        <ThemeForm initial={prefs} />
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>Senha do Painel</h2>
          <ChangePasswordForm />
        </div>

        <div className="card">
          <h2>Onde Ficam os Dados</h2>
          {online ? (
            <>
              <p className="small">
                {kind === "supabase-rest" ? (
                  <>
                    O painel está no modo online: os dados ficam no seu projeto do Supabase, acessado pela API com as
                    variáveis <span className="mono">SUPABASE_DATABASE_URL</span> e{" "}
                    <span className="mono">SUPABASE_SERVICE_ROLE_KEY</span> (extensão do Supabase no Netlify). O backup é
                    feito lá, no painel do Supabase.
                  </>
                ) : (
                  <>
                    O painel está no modo online: os dados ficam no banco Postgres apontado pela variável{" "}
                    <span className="mono">DATABASE_URL</span> (Supabase). O backup é feito lá, no painel do Supabase.
                  </>
                )}
              </p>
              <dl className="data">
                <dt>Modo</dt>
                <dd>{kind === "supabase-rest" ? "Online (Supabase pela API)" : "Online (Postgres)"}</dd>
                <dt>Cadastrados</dt>
                <dd>
                  {s.clients} cliente(s), {s.leads} lead(s), {s.events} evento(s)
                </dd>
              </dl>
              <div className="note note-warn" style={{ marginTop: 12 }}>
                O segredo que protege os tokens do Meta fica na tabela <span className="mono">settings</span> do banco
                (ou na variável <span className="mono">APP_SECRET</span>, se você a definir no Netlify). Se ele for
                perdido, os tokens precisam ser cadastrados de novo.
              </div>
            </>
          ) : (
            <>
              <p className="small">
                Tudo fica neste computador, em dois arquivos. Para fazer backup, copie a pasta inteira ou utilize o botão
                abaixo para baixar uma cópia do banco.
              </p>
              <dl className="data">
                <dt>Banco de Dados</dt>
                <dd className="mono">{paths?.db}</dd>
                <dt>Configuração</dt>
                <dd className="mono">{paths?.config}</dd>
                <dt>Tamanho</dt>
                <dd>{s.dbBytes === null ? "—" : `${(s.dbBytes / (1024 * 1024)).toFixed(2)} MB`}</dd>
                <dt>Cadastrados</dt>
                <dd>
                  {s.clients} cliente(s), {s.leads} lead(s), {s.events} evento(s)
                </dd>
              </dl>
              <div className="note note-warn" style={{ marginTop: 12 }}>
                O arquivo de configuração guarda o segredo que protege os tokens do Meta. Se ele for apagado, os tokens
                precisam ser cadastrados de novo (e a senha também).
              </div>
              <div style={{ marginTop: 14 }}>
                <a
                  href="/api/backup"
                  download
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "8px 14px",
                    borderRadius: "8px",
                    background: "rgba(123, 57, 252, 0.15)",
                    border: "1px solid rgba(123, 57, 252, 0.35)",
                    color: "#b394ff",
                    fontSize: "13px",
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  💾 Baixar Cópia de Segurança do Banco (.db)
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
