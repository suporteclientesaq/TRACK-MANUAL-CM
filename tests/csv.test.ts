import { describe, expect, it } from "vitest";
import { canonicalHeader, decodeCsv, detectDelimiter, fieldForHeader, parseCsv, rowsToRecords } from "@/lib/csv";

describe("parseCsv", () => {
  it("lê vírgula com aspas e quebra de linha dentro", () => {
    const rows = parseCsv('nome,telefone\n"Souza, Ana",5511999998888\n"Linha\ndupla",5588997057623\n');
    expect(rows).toEqual([
      ["nome", "telefone"],
      ["Souza, Ana", "5511999998888"],
      ["Linha\ndupla", "5588997057623"],
    ]);
  });
  it("lê ponto e vírgula (Excel em português) e CRLF", () => {
    const text = "Nome;Telefone\r\nAna;5511999998888\r\n";
    expect(detectDelimiter(text)).toBe(";");
    expect(parseCsv(text)).toEqual([["Nome", "Telefone"], ["Ana", "5511999998888"]]);
  });
  it("aspas duplas escapadas", () => {
    expect(parseCsv('a,b\n"Ana ""Aninha""",1')).toEqual([["a", "b"], ['Ana "Aninha"', "1"]]);
  });
  it("ignora linhas vazias", () => {
    expect(parseCsv("a,b\n\n1,2\n\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("decodeCsv", () => {
  it("tira o BOM do Excel", () => {
    expect(decodeCsv(new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x2c, 0x62]))).toBe("a,b");
  });
  it("entende arquivo em latin1", () => {
    const latin1 = new Uint8Array([0x4a, 0x6f, 0xe3, 0x6f, 0x2c, 0x31]); // "João,1" em latin1
    expect(decodeCsv(latin1)).toBe("João,1");
  });
});

describe("cabeçalhos", () => {
  it("normaliza acento, prefixo e espaços", () => {
    expect(canonicalHeader("Anúncio: CTWA Click ID")).toBe("ctwa_click_id");
    expect(canonicalHeader("  Telefone (WhatsApp) ")).toBe("telefone_whatsapp");
  });
  it("reconhece as colunas da Leona e as em português", () => {
    expect(fieldForHeader("ctwa_clid")).toBe("ctwa_clid");
    expect(fieldForHeader("Anúncio: CTWA Click ID")).toBe("ctwa_clid");
    expect(fieldForHeader("Anúncio: Source ID")).toBe("source_id");
    expect(fieldForHeader("Anúncio: Source URL")).toBe("source_url");
    expect(fieldForHeader("Anúncio: Thumbnail URL")).toBe("thumbnail_url");
    expect(fieldForHeader("Anúncio: Media URL")).toBe("media_url");
    expect(fieldForHeader("Nome")).toBe("name");
    expect(fieldForHeader("full_name")).toBe("name");
    expect(fieldForHeader("Telefone")).toBe("phone");
    expect(fieldForHeader("phone_number")).toBe("phone");
    expect(fieldForHeader("Celular")).toBe("phone");
    expect(fieldForHeader("E-mail")).toBe("email");
    expect(fieldForHeader("Cidade")).toBe("city");
    expect(fieldForHeader("UF")).toBe("state");
    expect(fieldForHeader("CEP")).toBe("zip");
  });
  it("ignora o que não interessa", () => {
    expect(fieldForHeader("Etiquetas")).toBeNull();
    expect(fieldForHeader("Última interação")).toBeNull();
    expect(fieldForHeader("comprovante pix")).toBeNull();
    expect(fieldForHeader("bairro")).toBeNull();
  });
  it("não confunde 'source_type' com 'source_id' nem 'ID do contato' com telefone", () => {
    expect(fieldForHeader("source_type")).toBe("source_type");
    expect(fieldForHeader("id")).toBeNull();
  });
});

describe("rowsToRecords", () => {
  it("monta os registros pelo cabeçalho e lista colunas ignoradas", () => {
    const rows = parseCsv(
      "Nome,Telefone,Etiquetas,ctwa_clid,source_id\nAna,5511999998888,vip,AbC123,120247299656290265\n"
    );
    const { records, mapping } = rowsToRecords(rows);
    expect(records).toEqual([{ name: "Ana", phone: "5511999998888", ctwa_clid: "AbC123", source_id: "120247299656290265" }]);
    expect(mapping.ignored).toEqual(["Etiquetas"]);
  });
  it("com duas colunas parecidas fica com a primeira", () => {
    const rows = parseCsv("phone,telefone\n1,2\n");
    const { records } = rowsToRecords(rows);
    expect(records[0].phone).toBe("1");
  });
});
