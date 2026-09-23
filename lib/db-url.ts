/**
 * Limpeza e diagnóstico da DATABASE_URL.
 *
 * Quem cola a string do Supabase no Netlify costuma deixar sobras: os colchetes
 * do "[YOUR-PASSWORD]", espaços, aspas, ou a senha com símbolos que quebram a
 * URL. Aqui a string é arrumada antes de ser usada, e os erros de conexão viram
 * explicações em português para a tela de configuração.
 */

export type DbUrlInfo = {
  user: string;
  password: string;
  host: string;
  port: string;
  database: string;
  /** A URL com a senha escondida, para mostrar na tela. */
  masked: string;
};

const PLACEHOLDERS = new Set(["YOUR-PASSWORD", "YOUR_PASSWORD", "SENHA", "PASSWORD", "SUA-SENHA", "SUA_SENHA"]);

/** Arruma a string: tira espaços, aspas e os colchetes em volta da senha, e codifica a senha. */
export function normalizeDatabaseUrl(raw: string | undefined | null): string {
  let s = (raw || "").replace(/\s+/g, "");
  s = s.replace(/^["'`]+|["'`]+$/g, "");
  if (!s) return "";
  // Quem cola "DATABASE_URL=postgres://..." inteiro no campo de valor.
  s = s.replace(/^DATABASE_URL=/i, "");
  const m = s.match(/^([a-z][a-z0-9+.-]*:\/\/)(.*)@([^@]*)$/i);
  if (!m) return s;
  const [, scheme, userinfo, rest] = m;
  const i = userinfo.indexOf(":");
  if (i < 0) return s;
  const user = userinfo.slice(0, i);
  let pass = userinfo.slice(i + 1);
  if (pass.startsWith("[") && pass.endsWith("]")) pass = pass.slice(1, -1);
  let decoded = pass;
  try {
    decoded = decodeURIComponent(pass);
  } catch {
    decoded = pass;
  }
  return `${scheme}${user}:${encodeURIComponent(decoded)}@${rest}`;
}

/** Separa as partes da URL (já normalizada) sem depender do parser do driver. */
export function describeDatabaseUrl(url: string): DbUrlInfo | null {
  const m = url.match(/^([a-z][a-z0-9+.-]*:\/\/)(?:([^@]*)@)?([^/?#]*)([^?#]*)(\?.*)?$/i);
  if (!m) return null;
  const [, scheme, userinfo = "", hostport, path = ""] = m;
  const i = userinfo.indexOf(":");
  const user = i < 0 ? userinfo : userinfo.slice(0, i);
  let password = i < 0 ? "" : userinfo.slice(i + 1);
  try {
    password = decodeURIComponent(password);
  } catch {
    // fica como está
  }
  const hp = hostport.match(/^(\[[^\]]*\]|[^:]*)(?::(\d+))?$/);
  const host = hp ? hp[1] : hostport;
  const port = hp?.[2] || "";
  const database = path.replace(/^\//, "");
  const masked = `${scheme}${user}${i < 0 ? "" : ":••••••"}@${hostport}${path}`;
  return { user, password, host, port, database, masked };
}

/** Problemas que dá para ver na própria string, antes de tentar conectar. */
export function databaseUrlAdvice(url: string): string | null {
  if (!url) return null;
  if (!/^postgres(ql)?:\/\//i.test(url)) {
    return "A DATABASE_URL precisa começar com postgresql://. Copie a URI inteira do Supabase (Connect > Transaction pooler).";
  }
  const info = describeDatabaseUrl(url);
  if (!info || !info.host) {
    return "Não consegui entender a DATABASE_URL. Ela tem de ser assim: postgresql://usuario:senha@endereco:6543/postgres";
  }
  if (PLACEHOLDERS.has(info.password.toUpperCase())) {
    return "A DATABASE_URL ainda está com o texto [YOUR-PASSWORD] no lugar da senha. Troque esse pedaço (com os colchetes) pela senha do banco que você escolheu ao criar o projeto no Supabase.";
  }
  // Sem senha só é problema no Supabase; um Postgres local pode confiar na conexão.
  if (!info.password && /\.supabase\.(com|co)$/i.test(info.host)) {
    return "A DATABASE_URL está sem a senha do banco. O formato é postgresql://usuario:SENHA@endereco:6543/postgres.";
  }
  const direct = info.host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
  if (direct) {
    return (
      `A DATABASE_URL está com a conexão direta do Supabase (${info.host}), que não funciona a partir do Netlify. ` +
      `No Supabase, clique em Connect e escolha "Transaction pooler". A URI certa é parecida com ` +
      `postgresql://postgres.${direct[1]}:SENHA@aws-0-REGIAO.pooler.supabase.com:6543/postgres`
    );
  }
  if (/\.pooler\.supabase\.com$/i.test(info.host) && !info.user.includes(".")) {
    return `Com o pooler do Supabase o usuário precisa ser "postgres.<código do projeto>" (na URI do Supabase ele já vem assim); a DATABASE_URL está só com "${info.user}".`;
  }
  return null;
}

/** Traduz o erro do driver para uma explicação com o que fazer. */
export function explainDatabaseError(err: unknown, url: string): string {
  const e = err as { message?: string; code?: string; severity?: string } | null;
  const msg = String(e?.message || err || "");
  const code = String(e?.code || "");
  const info = describeDatabaseUrl(url);
  const where = info?.host ? ` (${info.host}${info.port ? ":" + info.port : ""})` : "";

  if (/password authentication failed/i.test(msg) || code === "28P01") {
    return (
      "O banco recusou a senha. Confira a senha na DATABASE_URL: tem de ser a senha do banco escolhida ao criar o projeto no Supabase, " +
      "sem colchetes nem espaços. Se não lembra, no Supabase vá em Project Settings > Database > Reset database password, " +
      "crie uma nova (só letras e números) e atualize a DATABASE_URL."
    );
  }
  if (/tenant or user not found/i.test(msg)) {
    return (
      "O pooler do Supabase não encontrou o projeto. Ou o usuário está errado (tem de ser postgres.<código do projeto>), " +
      "ou a região do endereço não é a do seu projeto. Copie a URI de novo em Connect > Transaction pooler."
    );
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || /getaddrinfo/i.test(msg)) {
    return `O endereço do banco não existe${where}. Confira se copiou a URI inteira, sem faltar nem sobrar letras.`;
  }
  if (code === "ENETUNREACH" || code === "EHOSTUNREACH") {
    return `Não há rota até o banco${where}. Isso acontece com a conexão direta do Supabase (só IPv6). Use a URI do Transaction pooler.`;
  }
  if (code === "ECONNREFUSED") {
    return `O banco recusou a conexão${where}. Confira a porta (o Transaction pooler usa 6543) e se o projeto no Supabase não está pausado.`;
  }
  if (code === "ETIMEDOUT" || /timeout|timed out/i.test(msg)) {
    return `O banco não respondeu${where}. Confira se o projeto no Supabase está ativo (projetos gratuitos pausam depois de uma semana sem uso: abra o projeto e clique em Restore) e se a porta é 6543.`;
  }
  if (code === "3D000" || /database .* does not exist/i.test(msg)) {
    return `O banco "${info?.database || ""}" não existe nesse servidor. No Supabase o nome é "postgres".`;
  }
  if (code === "42501" || /permission denied/i.test(msg)) {
    return `O usuário do banco não tem permissão para criar as tabelas: ${msg}`;
  }
  if (/self.signed|certificate/i.test(msg)) {
    return `Problema no certificado SSL do banco${where}: ${msg}`;
  }
  return `Não consegui conectar ao banco${where}: ${msg}`;
}
