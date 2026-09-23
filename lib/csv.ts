/**
 * Leitor de CSV tolerante: aceita vírgula, ponto e vírgula ou tabulação,
 * aspas com quebras de linha dentro, BOM do Excel e arquivos em latin1.
 */

export function decodeCsv(bytes: Uint8Array): string {
  let text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  // Muitos "�" = o arquivo não era UTF-8 (Excel salva em latin1/windows-1252).
  const bad = (text.match(/�/g) || []).length;
  if (bad > 0 && bad * 200 > text.length) text = new TextDecoder("windows-1252").decode(bytes);
  return text.replace(/^﻿/, "");
}

export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const counts: [string, number][] = [
    [";", (firstLine.match(/;/g) || []).length],
    [",", (firstLine.match(/,/g) || []).length],
    ["\t", (firstLine.match(/\t/g) || []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

/** Nome de coluna limpo: minúsculas, sem acento, sem prefixo "Anúncio:", separado por _. */
export function canonicalHeader(h: string): string {
  return h
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/^\s*(anuncio|ad|ads|anuncios)\s*[:\-]\s*/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Campo do lead ao qual uma coluna corresponde, ou null se não interessa. */
export function fieldForHeader(header: string): string | null {
  const h = canonicalHeader(header);
  if (!h) return null;
  const has = (...parts: string[]) => parts.some((p) => h === p || h.includes(p));
  if (has("ctwa", "click_id", "clid")) return "ctwa_clid";
  if (has("thumbnail", "miniatura")) return "thumbnail_url";
  if (has("media_url", "midia", "media")) return "media_url";
  if (has("source_url", "url_de_origem", "url_origem", "origem_url")) return "source_url";
  if (has("source_type", "tipo_de_origem")) return "source_type";
  if (has("source_id", "id_de_origem", "id_origem", "ad_id", "id_do_anuncio", "anuncio_id", "sourceid")) return "source_id";
  if (has("headline", "titulo")) return "headline";
  if (has("phone", "telefone", "celular", "whatsapp", "numero", "number", "fone")) return "phone";
  if (has("email", "e_mail")) return "email";
  if (has("cidade", "city")) return "city";
  if (has("estado", "state", "uf")) return "state";
  if (has("cep", "zip")) return "zip";
  if (has("bairro")) return null;
  if (h === "name" || h === "nome" || has("full_name", "nome_completo", "first_name", "primeiro_nome", "nome_do_contato", "customer_name", "nome_cliente")) return "name";
  return null;
}

export interface CsvMapping {
  /** índice da coluna -> campo do lead */
  columns: Map<number, string>;
  ignored: string[];
}

export function mapHeaders(headers: string[]): CsvMapping {
  const columns = new Map<number, string>();
  const taken = new Set<string>();
  const ignored: string[] = [];
  headers.forEach((h, i) => {
    const field = fieldForHeader(h);
    if (field && !taken.has(field)) {
      columns.set(i, field);
      taken.add(field);
    } else if (h.trim()) ignored.push(h.trim());
  });
  return { columns, ignored };
}

/** Transforma as linhas do CSV em objetos { campo: valor }. */
export function rowsToRecords(rows: string[][]): { records: Record<string, string>[]; mapping: CsvMapping } {
  if (rows.length === 0) return { records: [], mapping: { columns: new Map(), ignored: [] } };
  const mapping = mapHeaders(rows[0]);
  const records = rows.slice(1).map((row) => {
    const rec: Record<string, string> = {};
    for (const [idx, field] of mapping.columns) rec[field] = (row[idx] ?? "").trim();
    return rec;
  });
  return { records, mapping };
}
