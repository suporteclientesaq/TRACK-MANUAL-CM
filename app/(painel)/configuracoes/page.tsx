import { cookies } from "next/headers";
import { isOnline, localPaths, stats, storeKind } from "@/lib/store";
import { THEME_COOKIE, parsePrefs } from "@/lib/theme";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { ThemeForm } from "./ThemeForm";

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
          <p className="muted small">Aparência, senha e onde os dados ficam guardados.</p>
        </div>
      </div>

      {salvo && <div className="note note-ok">Senha trocada.</div>}

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
                Tudo fica neste computador, em dois arquivos. Para fazer backup, copie a pasta inteira. Para levar o
                painel para outro computador, leve a pasta junto.
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
            </>
          )}
        </div>
      </div>
    </>
  );
}
