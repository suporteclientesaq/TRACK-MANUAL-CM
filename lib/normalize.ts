/**
 * Normalização dos dados do lead no formato que o Meta exige antes do hash.
 * Regras do Meta: tudo em minúsculas, sem espaços nas pontas; telefone só com
 * dígitos e DDI; cidade sem espaços nem pontuação; estado com 2 letras.
 */

/** DDD -> UF. Usado só como sugestão de estado quando o lead não informou. */
const DDD_UF: Record<string, string> = {
  "11": "SP", "12": "SP", "13": "SP", "14": "SP", "15": "SP", "16": "SP", "17": "SP", "18": "SP", "19": "SP",
  "21": "RJ", "22": "RJ", "24": "RJ",
  "27": "ES", "28": "ES",
  "31": "MG", "32": "MG", "33": "MG", "34": "MG", "35": "MG", "37": "MG", "38": "MG",
  "41": "PR", "42": "PR", "43": "PR", "44": "PR", "45": "PR", "46": "PR",
  "47": "SC", "48": "SC", "49": "SC",
  "51": "RS", "53": "RS", "54": "RS", "55": "RS",
  "61": "DF",
  "62": "GO", "64": "GO",
  "63": "TO",
  "65": "MT", "66": "MT",
  "67": "MS",
  "68": "AC",
  "69": "RO",
  "71": "BA", "73": "BA", "74": "BA", "75": "BA", "77": "BA",
  "79": "SE",
  "81": "PE", "87": "PE",
  "82": "AL",
  "83": "PB",
  "84": "RN",
  "85": "CE", "88": "CE",
  "86": "PI", "89": "PI",
  "91": "PA", "93": "PA", "94": "PA",
  "92": "AM", "97": "AM",
  "95": "RR",
  "96": "AP",
  "98": "MA", "99": "MA",
};

/**
 * Deixa o telefone só com dígitos e com DDI. Números brasileiros sem DDI
 * (10 ou 11 dígitos) recebem o 55. Devolve null se não parecer um telefone.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  // A Leona e o WhatsApp às vezes mandam "5511999998888@s.whatsapp.net".
  const base = input.split("@")[0].trim();
  const hasDdi = base.startsWith("+"); // com "+" o DDI já está no número
  let digits = base.replace(/\D/g, "").replace(/^0+/, "");
  if (!hasDdi && looksBrazilianWithoutDdi(digits)) digits = `55${digits}`;
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

/**
 * Número brasileiro digitado sem o 55: DDD válido + celular (9 dígitos começando
 * em 9) ou fixo (8 dígitos começando em 2 a 5). Evita confundir com número de
 * outro país que por acaso tenha 10 ou 11 dígitos (ex.: EUA, 1 + 10 dígitos).
 */
function looksBrazilianWithoutDdi(digits: string): boolean {
  if (!DDD_UF[digits.slice(0, 2)]) return false;
  if (digits.length === 11) return digits[2] === "9";
  if (digits.length === 10) return /[2-5]/.test(digits[2]);
  return false;
}

/**
 * Variações do telefone para o hash. O WhatsApp identifica muitos celulares
 * brasileiros sem o nono dígito (55 74 8146-1611), enquanto o cadastro da pessoa
 * no Facebook/Instagram costuma ter o número completo (55 74 98146-1611).
 * O Meta aceita vários hashes no mesmo campo, então mandamos as duas formas.
 */
export function phoneVariants(phone: string | null | undefined): string[] {
  const digits = normalizePhone(phone);
  if (!digits) return [];
  const variants = [digits];
  if (digits.startsWith("55") && DDD_UF[digits.slice(2, 4)]) {
    const local = digits.slice(4);
    // 8 dígitos começando em 6-9 = celular sem o nono dígito (fixo começa em 2-5)
    if (local.length === 8 && /[6-9]/.test(local[0])) {
      variants.push(`${digits.slice(0, 4)}9${local}`);
    }
  }
  return variants;
}

/** UF sugerida pelo DDD, só para números do Brasil. */
export function ufFromPhone(phone: string | null | undefined): string | null {
  const digits = normalizePhone(phone);
  if (!digits || !digits.startsWith("55") || digits.length < 12) return null;
  return DDD_UF[digits.slice(2, 4)] ?? null;
}

/**
 * Limpa um nome: converte letras "enfeitadas" (𝕲𝖎𝖑 -> Gil), tira emojis,
 * números e pontuação, mantém acentos. Devolve em minúsculas.
 */
export function cleanName(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .normalize("NFKC")
    .replace(/[^\p{L}\s'-]/gu, " ")
    .replace(/['-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Separa primeiro nome e sobrenome, já limpos. O sobrenome é a última palavra
 * ("Alexandra de Oliveira" -> alexandra / oliveira), que é a convenção mais usada.
 * Nome de WhatsApp é pouco confiável; o telefone continua sendo a chave forte.
 */
export function splitName(input: string | null | undefined): { fn: string; ln: string } {
  const parts = cleanName(input).split(" ").filter(Boolean);
  if (parts.length === 0) return { fn: "", ln: "" };
  if (parts.length === 1) return { fn: parts[0], ln: "" };
  return { fn: parts[0], ln: parts[parts.length - 1] };
}

/** Cidade no padrão do Meta: minúsculas, sem espaços, sem pontuação, sem acentos. */
export function normalizeCity(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/** Estado: sigla de 2 letras em minúsculas. Qualquer outra coisa é descartada. */
export function normalizeState(input: string | null | undefined): string {
  if (!input) return "";
  const s = input.trim().toLowerCase();
  return /^[a-z]{2}$/.test(s) ? s : "";
}

/** CEP: só dígitos. */
export function normalizeZip(input: string | null | undefined): string {
  if (!input) return "";
  return input.replace(/\D/g, "");
}

export function normalizeEmail(input: string | null | undefined): string {
  if (!input) return "";
  const e = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : "";
}

export function normalizeCountry(input: string | null | undefined): string {
  const c = (input || "br").trim().toLowerCase();
  return /^[a-z]{2}$/.test(c) ? c : "br";
}

/** Converte "29,90", "R$ 1.250,00" ou "29.9" em número. Devolve null se inválido. */
export function parseMoney(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  let s = String(input).trim().replace(/[^\d.,-]/g, "");
  if (!s) return null;
  if (s.includes(",")) {
    // padrão brasileiro: ponto é milhar, vírgula é decimal
    s = s.replace(/\./g, "").replace(",", ".");
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}
