export function StorageProblem({ message }: { message: string }) {
  return (
    <main className="login-wrap">
      <div className="card login-card" style={{ maxWidth: 520 }}>
        <h1>Track Manual</h1>
        <div className="note note-err">
          <strong>Falta configurar o banco de dados.</strong>
          <p style={{ marginTop: 8 }}>{message}</p>
        </div>
        <p className="muted small">
          No Netlify: Site configuration &gt; Environment variables &gt; Add a variable &gt; chave{" "}
          <span className="mono">DATABASE_URL</span>, valor = a URI do Transaction pooler do Supabase. Depois, Deploys
          &gt; Trigger deploy. O passo a passo completo está no README.
        </p>
      </div>
    </main>
  );
}
