import { describe, expect, it } from "vitest";
import {
  cleanName,
  normalizeCity,
  normalizePhone,
  normalizeState,
  parseMoney,
  phoneVariants,
  splitName,
  ufFromPhone,
} from "@/lib/normalize";

describe("normalizePhone", () => {
  it("mantém número já com DDI", () => {
    expect(normalizePhone("5511951907539")).toBe("5511951907539");
  });
  it("limpa máscara e sinal de mais", () => {
    expect(normalizePhone("+55 88 99705-7623")).toBe("5588997057623");
  });
  it("acrescenta 55 em número brasileiro sem DDI", () => {
    expect(normalizePhone("(88) 99705-7623")).toBe("5588997057623");
    expect(normalizePhone("8832221111")).toBe("558832221111");
  });
  it("aceita o formato do WhatsApp com @", () => {
    expect(normalizePhone("5511951907539@s.whatsapp.net")).toBe("5511951907539");
  });
  it("recusa lixo", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("{phone_number}")).toBeNull();
  });
});

describe("números de fora do Brasil", () => {
  it("não ganham 55 só por terem 11 dígitos", () => {
    expect(normalizePhone("14155552671")).toBe("14155552671");
  });
  it("com + na frente o DDI nunca é mexido", () => {
    expect(normalizePhone("+1 919 555 1234")).toBe("19195551234");
    expect(normalizePhone("+351 912 345 678")).toBe("351912345678");
  });
});

describe("phoneVariants", () => {
  it("acrescenta a forma com o nono dígito quando o WhatsApp manda sem", () => {
    expect(phoneVariants("557481461611")).toEqual(["557481461611", "5574981461611"]);
  });
  it("número completo vai sozinho", () => {
    expect(phoneVariants("5511951907539")).toEqual(["5511951907539"]);
  });
  it("fixo não ganha nono dígito", () => {
    expect(phoneVariants("558832221111")).toEqual(["558832221111"]);
  });
  it("número de fora vai sozinho", () => {
    expect(phoneVariants("14155552671")).toEqual(["14155552671"]);
  });
});

describe("ufFromPhone", () => {
  it("sugere a UF pelo DDD", () => {
    expect(ufFromPhone("5511951907539")).toBe("SP");
    expect(ufFromPhone("5588997057623")).toBe("CE");
    expect(ufFromPhone("556999998888")).toBe("RO");
    expect(ufFromPhone("5521976591644")).toBe("RJ");
  });
  it("não sugere para número de fora do Brasil", () => {
    expect(ufFromPhone("14155552671")).toBeNull();
  });
});

describe("nomes", () => {
  it("tira emoji", () => {
    expect(cleanName("Dioni Santana 🥰")).toBe("dioni santana");
  });
  it("converte letras enfeitadas", () => {
    expect(cleanName("ℭ𝔩𝔢𝔲𝔫𝔦𝔡𝔦𝔞 𝕲𝖎𝖑")).toBe("cleunidia gil");
  });
  it("mantém acento", () => {
    expect(cleanName("Valquíria")).toBe("valquíria");
  });
  it("separa primeiro nome e último sobrenome", () => {
    expect(splitName("Alexandra De Oliveira")).toEqual({ fn: "alexandra", ln: "oliveira" });
    expect(splitName("🦁Daimar Pinheiro🌹")).toEqual({ fn: "daimar", ln: "pinheiro" });
    expect(splitName("Lili")).toEqual({ fn: "lili", ln: "" });
    expect(splitName("🥰🥰")).toEqual({ fn: "", ln: "" });
  });
});

describe("local", () => {
  it("cidade sem acento, espaço ou pontuação", () => {
    expect(normalizeCity("São Paulo")).toBe("saopaulo");
    expect(normalizeCity("Juazeiro do Norte - CE")).toBe("juazeirodonortece");
    expect(normalizeCity("Porto Velho")).toBe("portovelho");
  });
  it("estado só com 2 letras", () => {
    expect(normalizeState("CE")).toBe("ce");
    expect(normalizeState(" ro ")).toBe("ro");
    expect(normalizeState("Ceará")).toBe("");
  });
});

describe("parseMoney", () => {
  it("entende o padrão brasileiro", () => {
    expect(parseMoney("29,90")).toBe(29.9);
    expect(parseMoney("R$ 1.250,00")).toBe(1250);
    expect(parseMoney("147")).toBe(147);
  });
  it("entende ponto decimal", () => {
    expect(parseMoney("29.9")).toBe(29.9);
  });
  it("recusa valor inválido", () => {
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("-5")).toBeNull();
  });
});
