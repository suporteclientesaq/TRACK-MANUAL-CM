/**
 * Limpeza e diagnóstico da DATABASE_URL.
 *
 * Quem cola uma string de Postgres no servidor pode deixar sobras: os colchetes
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

/** Identify the provider from the actual endpoint, never from an error's wording. */
export function isSupabaseDatabase(url: string | null | undefined): boolean {
  if (!url) return false;
  let host = describeDatabaseUrl(url)?.host || "";
  if (!host) {
    try {
      host = new URL(url).hostname;
    } catch {
      return false;
    }
  }
  return /(?:^|\.)supabase\.(?:co|com|in|red)$/i.test(host);
}

const PLACEHOLDERS = new Set([
  "YOUR-PASSWORD",
  "YOUR_PASSWORD",
  "SENHA",
  "PASSWORD",
  "SUA-SENHA",
  "SUA_SENHA",
]);

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
  const m = url.match(
    /^([a-z][a-z0-9+.-]*:\/\/)(?:([^@]*)@)?([^/?#]*)([^?#]*)(\?.*)?$/i,
  );
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
    return "A DATABASE_URL precisa começar com postgresql://. Copie a URI de conexão completa fornecida pelo seu provedor de Postgres.";
  }
  const info = describeDatabaseUrl(url);
  if (!info || !info.host) {
    return "Não consegui entender a DATABASE_URL. Use o formato postgresql://usuario:senha@servidor:porta/banco e mantenha o endereço e a porta fornecidos pelo provedor.";
  }
  if (PLACEHOLDERS.has(info.password.toUpperCase())) {
    return "A DATABASE_URL ainda está com o texto [YOUR-PASSWORD] no lugar da senha. Troque esse pedaço (com os colchetes) pela senha do banco fornecida pelo seu provedor.";
  }
  // Sem senha só é problema no Supabase; um Postgres local pode confiar na conexão.
  if (!info.password && isSupabaseDatabase(url)) {
    return "A DATABASE_URL está sem a senha do banco. Copie a URI completa em Connect e preserve host, porta e usuário do endpoint escolhido.";
  }
  if (/\.pooler\.supabase\.com$/i.test(info.host) && !info.user.includes(".")) {
    return `Com o pooler do Supabase o usuário precisa ser "postgres.<código do projeto>" (na URI do Supabase ele já vem assim); a DATABASE_URL está só com "${info.user}".`;
  }
  return null;
}

/** Redact credentials even when the driver repeats a connection string. */
export function redactDatabaseMessage(message: string, url: string): string {
  const info = describeDatabaseUrl(url);
  let safe = message.replace(
    /postgres(?:ql)?:\/\/[^\s"'<>]+/gi,
    (value) =>
      describeDatabaseUrl(value)?.masked || "[endereço do banco omitido]",
  );
  if (info?.password) {
    const password = info.password;
    if (password.length < 4 && safe.includes(password))
      return "Detalhes técnicos omitidos para proteger a credencial do banco.";
    safe = safe
      .replaceAll(password, "••••••")
      .replaceAll(encodeURIComponent(password), "••••••");
  }
  try {
    for (const [key, value] of new URL(url).searchParams) {
      if (value && /pass|token|secret|api.?key|credential/i.test(key))
        safe = safe.replaceAll(value, "[oculto]");
    }
  } catch {
    /* malformed URLs are diagnosed before connecting */
  }
  safe = safe.replace(
    /((?:password|access_token|api_key|apikey|secret)\s*[=:]\s*)[^\s,;]+/gi,
    "$1[oculto]",
  );
  return safe.slice(0, 1200);
}

/** Traduz o erro do driver sem presumir que todo Postgres é Supabase. */
export function explainDatabaseError(err: unknown, url: string): string {
  const e = err as {
    message?: string;
    code?: string;
    severity?: string;
  } | null;
  const msg = String(e?.message || err || "");
  const code = String(e?.code || "");
  const info = describeDatabaseUrl(url);
  const where = info?.host
    ? ` (${info.host}${info.port ? ":" + info.port : ""})`
    : "";
  const supabase = isSupabaseDatabase(url);
  const safeMessage = redactDatabaseMessage(msg, url);

  if (
    code === "ERR_TLS_CERT_ALTNAME_INVALID" ||
    /(?:hostname|ip).*does not match|altnames|certificate.*hostname/i.test(msg)
  ) {
    return `O nome no certificado SSL não corresponde ao endereço do banco${where}. Confira o hostname da DATABASE_URL e peça ao provedor um certificado válido para esse endereço. A CA não corrige um nome de servidor incorreto.`;
  }
  if (code === "CERT_HAS_EXPIRED" || /certificate has expired/i.test(msg)) {
    return `O certificado SSL do banco expirou${where}. Peça ao provedor a renovação do certificado e confira a data do servidor que executa o painel.`;
  }
  if (
    code === "CERT_NOT_YET_VALID" ||
    /certificate is not yet valid/i.test(msg)
  ) {
    return `O certificado SSL do banco ainda não é válido${where}. Confira a data do servidor e o início de validade do certificado com o provedor.`;
  }
  if (
    /self.signed|certificate|unable to verify/i.test(msg) ||
    [
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "SELF_SIGNED_CERT_IN_CHAIN",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
      "CERT_UNTRUSTED",
    ].includes(code)
  ) {
    return `Não foi possível validar o certificado SSL do banco${where}. Obtenha o certificado CA oficial com o provedor e configure DATABASE_SSL_CA no ambiente do Track Manual. Mantenha a verificação TLS ativa e use o host e a porta da URI fornecida pelo provedor.`;
  }
  if (/password authentication failed/i.test(msg) || code === "28P01") {
    return supabase
      ? "O banco recusou a senha. Confira a senha do banco na DATABASE_URL. Se necessário, redefina-a nas configurações do banco no Supabase, atualize o ambiente e faça um novo deploy."
      : `O banco recusou a senha${where}. Confira a credencial e o usuário fornecidos pelo provedor na DATABASE_URL, atualize o ambiente do servidor e faça um novo deploy.`;
  }
  if (/tenant or user not found/i.test(msg)) {
    return supabase
      ? "O pooler do Supabase não encontrou o projeto. Confira usuário, região e endpoint na URI copiada de Connect; o usuário do pooler inclui o código do projeto."
      : `O servidor não encontrou o usuário ou a instância do banco${where}. Confira usuário, banco e endpoint na URI fornecida pelo provedor.`;
  }
  if (
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    /getaddrinfo/i.test(msg)
  ) {
    return `O endereço do banco não existe${where}. Confira o hostname e a resolução DNS no ambiente que executa o painel.`;
  }
  if (code === "ENETUNREACH" || code === "EHOSTUNREACH") {
    return supabase
      ? `Não há rota até o banco${where}. Se o endpoint direto usa IPv6 e seu ambiente só oferece IPv4, copie um endpoint de pooler compatível em Connect ou confira o IPv4 add-on do projeto.`
      : `Não há rota até o banco${where}. Confira DNS, IPv4/IPv6, firewall e regras de acesso de rede com o provedor.`;
  }
  if (code === "ECONNREFUSED") {
    return supabase
      ? `O banco recusou a conexão${where}. Confira o endpoint e a porta copiados de Connect e se o projeto do Supabase está ativo.`
      : `O banco recusou a conexão${where}. Confira a porta fornecida pelo provedor e se o serviço permite conexões a partir deste servidor.`;
  }
  if (code === "ETIMEDOUT" || /timeout|timed out/i.test(msg)) {
    return supabase
      ? `O banco não respondeu${where}. Confira o projeto no Supabase; projetos gratuitos podem estar pausados. Verifique também endpoint, porta e acesso de rede.`
      : `O banco não respondeu${where}. Confira disponibilidade, firewall e permissão de acesso ao host e à porta fornecidos pelo provedor.`;
  }
  if (code === "3D000" || /database .* does not exist/i.test(msg)) {
    return supabase
      ? `O banco "${info?.database || ""}" não existe nesse servidor. Confira o nome na URI de Connect do Supabase.`
      : `O banco "${info?.database || ""}" não existe nesse servidor${where}. Confira o nome exato informado pelo provedor.`;
  }
  if (code === "42501" || /permission denied/i.test(msg)) {
    return `O usuário do banco não tem permissão para a operação: ${safeMessage}`;
  }
  return `Não consegui conectar ao banco${where}: ${safeMessage}`;
}
