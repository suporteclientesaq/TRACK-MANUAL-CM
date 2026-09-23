import { normalizePhone, ufFromPhone } from "./normalize";

/** Campos do lead que o painel entende, com os nomes alternativos aceitos na entrada. */
const FIELD_ALIASES: Record<string, string[]> = {
  name: ["name", "nome", "first_name", "full_name", "customer_name", "nome_cliente", "nome_completo"],
  phone: ["phone", "phone_number", "number", "numero", "telefone", "lead_number", "whatsapp", "celular", "fone"],
  email: ["email", "e-mail", "e_mail"],
  city: ["city", "cidade", "local", "localidade"],
  state: ["state", "estado", "uf"],
  zip: ["zip", "cep", "zipcode", "zip_code"],
  ctwa_clid: ["ctwa_clid", "ctwaclid", "ctwa", "clid", "click_id"],
  source_id: ["source_id", "sourceid", "ad_id", "id_origem"],
  source_url: ["source_url", "sourceurl", "url_origem"],
  source_type: ["source_type", "sourcetype"],
  thumbnail_url: ["thumbnail_url", "thumbnailurl", "thumbnail", "url_miniatura", "miniatura"],
  media_url: ["media_url", "mediaurl", "image_url", "video_url"],
  headline: ["headline", "titulo", "title"],
  ad_body: ["ad_body", "body", "texto_anuncio"],
};

export interface ParsedLead {
  name: string | null;
  phone: string;
  email: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  ctwa_clid: string | null;
  source_id: string | null;
  source_url: string | null;
  source_type: string | null;
  thumbnail_url: string | null;
  media_url: string | null;
  headline: string | null;
  ad_body: string | null;
}

/**
 * Valor vazio de verdade. Quando a variável não existe para o contato, a Leona
 * pode mandar o próprio marcador ("{ctwa_clid}") ou textos como "null".
 */
function clean(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/^\{\{?[^{}]*\}?\}$/.test(s)) return null;
  if (/^(null|undefined|nil|none|n\/a|-)$/i.test(s)) return null;
  return s;
}

/**
 * Lê o corpo enviado pela Leona. Aceita JSON, formulário (a=b&c=d) e, como
 * último recurso, JSON "quebrado" (por exemplo, nome com aspas no meio).
 */
export function parseBody(text: string, contentType: string | null): Record<string, unknown> {
  const body = (text || "").trim();
  if (!body) return {};
  if (body.startsWith("{")) {
    try {
      const json = JSON.parse(body);
      if (json && typeof json === "object" && !Array.isArray(json)) return flatten(json);
    } catch {
      return lenientJson(body);
    }
  }
  if ((contentType || "").includes("form") || /^[\w.%-]+=/.test(body)) {
    return Object.fromEntries(new URLSearchParams(body));
  }
  return {};
}

/** Aceita campos dentro de objetos como { customer: {...}, referral: {...} }. */
function flatten(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (o: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === "object" && !Array.isArray(v)) walk(v as Record<string, unknown>);
      else if (out[k] === undefined) out[k] = v;
    }
  };
  walk(obj);
  return out;
}

function lenientJson(body: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // "chave": "valor"  — o valor vai até a aspa que precede vírgula, quebra de linha ou }
  const re = /"([\w.-]+)"\s*:\s*"([\s\S]*?)"\s*(?=,\s*"[\w.-]+"\s*:|\s*\}\s*$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out[m[1]] = m[2];
  return out;
}

export function parseLead(
  fields: Record<string, unknown>
): { ok: true; lead: ParsedLead } | { ok: false; error: string } {
  const lower: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) lower[k.toLowerCase().trim()] = v;

  const pick = (field: string): string | null => {
    for (const alias of FIELD_ALIASES[field]) {
      const v = clean(lower[alias]);
      if (v) return v;
    }
    return null;
  };

  const phone = normalizePhone(pick("phone"));
  if (!phone) {
    return { ok: false, error: "telefone ausente ou inválido." };
  }

  const state = pick("state");
  return {
    ok: true,
    lead: {
      name: pick("name"),
      phone,
      email: pick("email"),
      city: pick("city"),
      state: state && /^[a-zA-Z]{2}$/.test(state) ? state.toUpperCase() : ufFromPhone(phone),
      zip: pick("zip"),
      ctwa_clid: pick("ctwa_clid"),
      source_id: pick("source_id"),
      source_url: pick("source_url"),
      source_type: pick("source_type"),
      thumbnail_url: pick("thumbnail_url"),
      media_url: pick("media_url"),
      headline: pick("headline"),
      ad_body: pick("ad_body"),
    },
  };
}

/**
 * Junta o que chegou agora com o que já estava salvo.
 * Regra: dado novo preenchido vence; dado novo vazio nunca apaga o antigo.
 * Exceção de cuidado: cidade, estado e CEP editados à mão no painel são mantidos.
 */
export function mergeLead(existing: object | null, incoming: ParsedLead): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keepIfSet = new Set(["city", "state", "zip", "email"]);
  const prev = (existing || {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(incoming)) {
    const old = existing ? prev[key] : null;
    if (value === null || value === "") {
      if (old !== undefined && old !== null) out[key] = old;
      continue;
    }
    out[key] = keepIfSet.has(key) && old ? old : value;
  }
  return out;
}
