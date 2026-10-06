/**
 * Parser de proposta comercial em .TXT (formato Continental MKT).
 * Extrai os campos do lead a partir do texto estruturado com emojis como prefixo.
 *
 * Exemplo de entrada:
 *   🏢 Empresa: Potência Moto Peças
 *   📞 Telefone/WhatsApp: +55 94 9309-2043
 *   📍 Cidade: Marabá – PA
 *   📮 CEP: 68508-000
 *   💰 Investimento: R$ 247,00
 */

import { normalizePhone } from "./normalize";

export interface TxtProposalResult {
  ok: true;
  fields: {
    name: string | null;
    phone: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    notes: string | null;
  };
}

export interface TxtProposalError {
  ok: false;
  error: string;
}

/**
 * Remove emojis e símbolos do início de uma linha, retornando só o texto útil.
 */
function stripEmojis(s: string): string {
  // Remove qualquer sequência de caracteres não-ASCII no começo
  return s.replace(/^[\u{0080}-\u{FFFF}\u{10000}-\u{10FFFF}\s]+/u, "").trim();
}

/**
 * Tenta fazer match de um padrão de label + valor na linha.
 * Aceita o rótulo de forma case-insensitive e com ou sem emoji antes.
 *
 * Ex: "📞 Telefone/WhatsApp: +55 94 9309-2043"
 * Ex: "Empresa: Potência Moto Peças"
 */
function extractField(lines: string[], ...labels: string[]): string | null {
  for (const line of lines) {
    const clean = stripEmojis(line);
    for (const label of labels) {
      const re = new RegExp(`^${label}\\s*[:/]\\s*(.+)$`, "i");
      const m = re.exec(clean);
      if (m) {
        const value = m[1].trim();
        if (value) return value;
      }
    }
  }
  return null;
}

/**
 * Extrai a UF de strings como "Marabá – PA" ou "São Paulo - SP".
 * Retorna a sigla de 2 letras ou null.
 */
function extractUF(cityStateStr: string): { city: string; state: string | null } {
  // Tenta "Cidade – UF" ou "Cidade - UF"
  const m = cityStateStr.match(/^(.+?)\s*[–\-]\s*([A-Z]{2})\s*$/);
  if (m) {
    return { city: m[1].trim(), state: m[2].toUpperCase() };
  }
  return { city: cityStateStr.trim(), state: null };
}

/**
 * Parseia o texto completo de uma proposta comercial e extrai os campos do lead.
 */
export function parseTxtProposal(text: string): TxtProposalResult | TxtProposalError {
  if (!text || !text.trim()) {
    return { ok: false, error: "Arquivo vazio." };
  }

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Nome da empresa
  const rawName = extractField(lines, "Empresa", "Nome", "Razão Social", "Company");

  // Telefone
  const rawPhone = extractField(
    lines,
    "Telefone",
    "Telefone/WhatsApp",
    "WhatsApp",
    "Phone",
    "Celular",
    "Fone",
    "Contato"
  );

  if (!rawPhone) {
    return { ok: false, error: "Telefone/WhatsApp não encontrado no arquivo." };
  }

  const phone = normalizePhone(rawPhone);
  if (!phone) {
    return { ok: false, error: `Telefone inválido: "${rawPhone}".` };
  }

  // Cidade + Estado
  const rawCity = extractField(lines, "Cidade", "City", "Município", "Local");
  let city: string | null = null;
  let state: string | null = null;

  if (rawCity) {
    const parsed = extractUF(rawCity);
    city = parsed.city || null;
    state = parsed.state || null;
  }

  // Estado separado (caso não venha junto da cidade)
  if (!state) {
    const rawState = extractField(lines, "Estado", "UF", "State");
    if (rawState && /^[A-Za-z]{2}$/.test(rawState.trim())) {
      state = rawState.trim().toUpperCase();
    }
  }

  // CEP
  const rawZip = extractField(lines, "CEP", "Zip", "Código Postal");
  const zip = rawZip ? rawZip.replace(/\D/g, "") || null : null;

  // Notas: investimento + pacote como observação
  const rawInvestimento = extractField(lines, "Investimento", "Valor", "Investment");
  const rawPacote = extractField(lines, "Pacote", "Package", "Produto", "Plano");
  const rawPeriodo = extractField(lines, "Período", "Periodo", "Prazo", "Duration");
  const rawInstagram = extractField(lines, "Instagram", "IG", "Perfil");

  const noteParts: string[] = [];
  if (rawPacote) noteParts.push(`Pacote: ${rawPacote}`);
  if (rawPeriodo) noteParts.push(`Período: ${rawPeriodo}`);
  if (rawInvestimento) noteParts.push(`Investimento: ${rawInvestimento}`);
  if (rawInstagram) noteParts.push(`Instagram: ${rawInstagram}`);

  const notes = noteParts.length > 0 ? noteParts.join(" | ") : null;

  return {
    ok: true,
    fields: {
      name: rawName || null,
      phone,
      city,
      state,
      zip,
      notes,
    },
  };
}
