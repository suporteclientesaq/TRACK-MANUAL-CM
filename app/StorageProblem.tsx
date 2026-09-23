import { CopyBox } from "@/app/(painel)/clientes/[id]/CopyBox";

export function StorageProblem({
  message,
  database,
  sql,
}: {
  message: string;
  database?: string | null;
  sql?: string | null;
}) {
  const title = sql ? "Falta criar as tabelas no Supabase." : database ? "O banco de dados não conectou." : "Falta configurar o banco de dados.";
  return (
    <main className="login-wrap">
      <div className="card login-card" style={{ maxWidth: sql ? 720 : 560 }}>
        <h1>Track Manual</h1>
        <div className={sql ? "note note-warn" : "note note-err"}>
          <strong>{title}</strong>
          <p style={{ marginTop: 8 }}>{message}</p>
        </div>

        {sql ? (
          <>
            <ol className="small" style={{ paddingLeft: 20, margin: "12px 0" }}>
              <li>Abra o seu projeto em supabase.com e clique em <strong>SQL Editor</strong> (menu da esquerda).</li>
              <li>Clique em <strong>Copiar</strong> abaixo e cole no editor (Ctrl+V).</li>
              <li>Clique em <strong>Run</strong> (ou Ctrl+Enter). Tem que aparecer "Success".</li>
              <li>Volte aqui e recarregue a página.</li>
            </ol>
            <CopyBox label="SQL para colar no Supabase" value={sql} multiline />
            <p className="muted small">
              Projeto: <span className="mono">{database}</span>
            </p>
          </>
        ) : (
          <>
            {database ? (
              <p className="muted small">
                Endereço cadastrado (senha escondida):
                <br />
                <span className="mono" style={{ wordBreak: "break-all" }}>
                  {database}
                </span>
              </p>
            ) : null}
            <p className="muted small">
              Dois jeitos de ligar o banco no Netlify. <strong>Pela extensão</strong>: Extensions &gt; Supabase &gt;
              Connect, escolha o projeto e salve; ela cria as variáveis sozinha. <strong>Pela variável</strong>: Site
              configuration &gt; Environment variables &gt; <span className="mono">DATABASE_URL</span>
              {database ? " > Options > Edit" : " > Add a variable"}, valor = a URI do <strong>Transaction pooler</strong>{" "}
              do Supabase (Connect, no topo do projeto), com a senha do banco no lugar de{" "}
              <span className="mono">[YOUR-PASSWORD]</span>. Nos dois casos, depois: Deploys &gt; Trigger deploy &gt;
              Deploy site.
              {database ? " Esta tela testa a conexão de novo sozinha; basta recarregar depois do deploy." : ""}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
