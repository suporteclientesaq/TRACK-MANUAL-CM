import { cookies } from "next/headers";
import {
  Database,
  Download,
  Palette,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  getSetting,
  isOnline,
  localPaths,
  stats,
  storeKind,
} from "@/lib/store";
import { THEME_COOKIE, parsePrefs } from "@/lib/theme";
import { APP_VERSION } from "@/lib/version";
import { SystemSettingsForm } from "./SystemSettingsForm";
import { ThemeForm } from "./ThemeForm";
import { ChangePasswordForm } from "./ChangePasswordForm";
import styles from "./Settings.module.css";
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ salvo?: string }>;
}) {
  const { salvo } = await searchParams;
  const [counts, jar] = await Promise.all([stats(), cookies()]);
  const online = isOnline();
  const paths = localPaths();
  const kind = storeKind();
  const keys = [
    "sound_notifications",
    "tab_badge_notifications",
    "system_favicon_url",
    "media_retention_days",
  ];
  const values = await Promise.all(keys.map((key) => getSetting(key)));
  const initialSettings = Object.fromEntries(
    keys.map((key, index) => [key, values[index] || undefined]),
  );
  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>PREFERÊNCIAS</span>
          <h1>Seu workspace, do seu jeito.</h1>
          <p>
            Personalize a aparência, cuide dos dados e mantenha seu acesso
            protegido.
          </p>
        </div>
        <span className={styles.version}>
          <Sparkles size={14} />
          Track Manual Flow · v{APP_VERSION}
        </span>
      </div>
      {salvo && (
        <p className={styles.notice} role="status">
          Senha atualizada. As sessões anteriores foram revogadas.
        </p>
      )}
      <div className={styles.grid}>
        <section className={styles.card}>
          <div className={styles.cardHeading}>
            <span>
              <Settings2 size={19} />
            </span>
            <div>
              <h2>Preferências do workspace</h2>
              <p>Identidade, notificações e arquivos do atendimento.</p>
            </div>
          </div>
          <SystemSettingsForm initialSettings={initialSettings} />
        </section>
        <section className={styles.card}>
          <div className={styles.cardHeading}>
            <span>
              <Palette size={19} />
            </span>
            <div>
              <h2>Aparência</h2>
              <p>Escolha o tema e a cor para trabalhar com conforto.</p>
            </div>
          </div>
          <div className={styles.cardBody}>
            <ThemeForm initial={parsePrefs(jar.get(THEME_COOKIE)?.value)} />
          </div>
        </section>
        <section className={styles.card}>
          <div className={styles.cardHeading}>
            <span>
              <ShieldCheck size={19} />
            </span>
            <div>
              <h2>Acesso ao painel</h2>
              <p>Uma senha exclusiva para o administrador.</p>
            </div>
          </div>
          <div className={styles.cardBody}>
            <ChangePasswordForm />
          </div>
        </section>
        <section className={styles.card}>
          <div className={styles.cardHeading}>
            <span>
              <Database size={19} />
            </span>
            <div>
              <h2>Dados e recuperação</h2>
              <p>
                {online
                  ? "Armazenamento online"
                  : "Armazenamento neste servidor"}
              </p>
            </div>
          </div>
          <div className={styles.cardBody}>
            <div className={styles.dataStats}>
              <span>
                <strong>{counts.clients}</strong>clientes
              </span>
              <span>
                <strong>{counts.leads}</strong>contatos
              </span>
              <span>
                <strong>{counts.events}</strong>eventos
              </span>
            </div>
            <dl className={styles.data}>
              <dt>Modo</dt>
              <dd>
                {kind === "sqlite"
                  ? "SQLite local"
                  : kind === "postgres"
                    ? "Postgres"
                    : "Supabase REST"}
              </dd>
              {!online && (
                <>
                  <dt>Banco</dt>
                  <dd>{paths?.db}</dd>
                  <dt>Configuração</dt>
                  <dd>{paths?.config}</dd>
                  <dt>Tamanho do banco</dt>
                  <dd>
                    {counts.dbBytes === null
                      ? "—"
                      : (counts.dbBytes / 1024 / 1024).toFixed(2) + " MB"}
                  </dd>
                </>
              )}
            </dl>
            <p className={styles.recoveryNote}>
              <ShieldCheck size={15} />
              <span>
                {online
                  ? "Mantenha os backups no provedor do banco e preserve o APP_SECRET em local seguro."
                  : "O download contém uma cópia consistente do banco. Preserve config.json ou APP_SECRET separadamente para recuperar os tokens. As sessões WhatsApp também precisam de backup próprio."}
              </span>
            </p>
            {!online && (
              <a href="/api/backup" download className={styles.download}>
                <Download size={14} />
                Baixar backup do banco
              </a>
            )}
          </div>
        </section>
      </div>
      <p className={styles.bottomNote}>
        As preferências de aparência ficam neste navegador. As demais
        configurações valem para o workspace.
      </p>
    </div>
  );
}
