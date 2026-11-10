import { CopyBox } from "@/app/(painel)/clientes/[id]/CopyBox";
import {
  describeDatabaseUrl,
  isSupabaseDatabase,
  redactDatabaseMessage,
} from "@/lib/db-url";

function databaseLabel(database: string): string {
  if (/^postgres(?:ql)?:\/\//i.test(database)) {
    return (
      describeDatabaseUrl(database)?.masked || "Endereço de Postgres inválido."
    );
  }
  try {
    const url = new URL(database);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "Endereço não disponível.";
  }
}

export function StorageProblem({
  message,
  database,
  sql,
}: {
  message: string;
  database?: string | null;
  sql?: string | null;
}) {
  const supabase = isSupabaseDatabase(database);
  const safeMessage = redactDatabaseMessage(message, database || "");
  const needsCa = safeMessage.includes("DATABASE_SSL_CA");
  const title = sql
    ? "Falta criar as tabelas no Supabase."
    : database
      ? "O banco de dados não conectou."
      : "Falta configurar o banco de dados.";
  return (
    <main className="login-wrap">
      <div className="card login-card" style={{ maxWidth: sql ? 720 : 600 }}>
        <h1>Track Manual</h1>
        <div className={sql ? "note note-warn" : "note note-err"}>
          <strong>{title}</strong>
          <p style={{ marginTop: 8 }}>{safeMessage}</p>
        </div>

        {sql ? (
          <>
            <ol className="small" style={{ paddingLeft: 20, margin: "12px 0" }}>
              <li>
                Abra o seu projeto em supabase.com e clique em{" "}
                <strong>SQL Editor</strong> (menu da esquerda).
              </li>
              <li>
                Clique em <strong>Copiar</strong> abaixo e cole no editor
                (Ctrl+V).
              </li>
              <li>
                Clique em <strong>Run</strong> (ou Ctrl+Enter). Tem que aparecer
                "Success".
              </li>
              <li>Volte aqui e recarregue a página.</li>
            </ol>
            <CopyBox label="SQL para colar no Supabase" value={sql} multiline />
            <p className="muted small">
              Projeto:{" "}
              <span className="mono">
                {database ? databaseLabel(database) : ""}
              </span>
            </p>
          </>
        ) : (
          <>
            {database ? (
              <p className="muted small">
                Endereço cadastrado (senha escondida):
                <br />
                <span className="mono" style={{ wordBreak: "break-all" }}>
                  {databaseLabel(database)}
                </span>
              </p>
            ) : null}
            {needsCa && (
              <div className="note note-warn small">
                <strong>Certificado do provedor</strong>
                <p>
                  Cadastre <span className="mono">DATABASE_SSL_CA</span> com o
                  certificado CA oficial em PEM completo, incluindo as linhas
                  BEGIN/END CERTIFICATE. São aceitas quebras de linha reais ou
                  a sequência <code>{"\\n"}</code>.
                </p>
              </div>
            )}
            {supabase ? (
              <p className="muted small">
                Este endereço é do Supabase. No Netlify, você pode usar
                Extensions &gt; Supabase &gt; Connect ou conferir a URI de
                Postgres em <strong>Connect</strong> no painel do projeto.
                Escolha o endpoint adequado ao ambiente; funções serverless
                normalmente usam o <strong>Transaction pooler</strong>. Copie
                host, porta e usuário da URI oficial. Depois de alterar as
                variáveis, faça um novo deploy em Deploys &gt; Trigger deploy
                &gt; Deploy site e recarregue esta página.
              </p>
            ) : (
              <p className="muted small">
                Use a URI oficial do seu provedor de Postgres em{" "}
                <span className="mono">DATABASE_URL</span>, com o host, a porta
                e o nome do banco fornecidos por ele. Salve as variáveis no
                ambiente que executa o Track Manual. Em uma VPS com Docker,
                recrie o contêiner do Track Manual com as variáveis atualizadas
                e o volume existente. Em hospedagem gerenciada, publique um
                novo deploy. Depois recarregue esta página.
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
