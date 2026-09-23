import { describe, expect, it } from "vitest";
import { mergeLead, parseBody, parseLead } from "@/lib/leona";

describe("parseBody", () => {
  it("lê JSON", () => {
    expect(parseBody('{"name":"Ana","phone":"5511999998888"}', "application/json")).toEqual({
      name: "Ana",
      phone: "5511999998888",
    });
  });
  it("lê campos dentro de objetos", () => {
    const out = parseBody('{"customer":{"name":"Ana","phone":"5511999998888"},"referral":{"ctwa_clid":"abc"}}', null);
    expect(out).toMatchObject({ name: "Ana", phone: "5511999998888", ctwa_clid: "abc" });
  });
  it("lê formulário", () => {
    expect(parseBody("name=Ana&phone=5511999998888", "application/x-www-form-urlencoded")).toEqual({
      name: "Ana",
      phone: "5511999998888",
    });
  });
  it("recupera JSON quebrado por aspas no nome", () => {
    const broken = '{\n  "name": "Ana "Aninha" Souza",\n  "phone": "5511999998888",\n  "ctwa_clid": "AbC-123_x"\n}';
    const out = parseBody(broken, "application/json");
    expect(out.phone).toBe("5511999998888");
    expect(out.ctwa_clid).toBe("AbC-123_x");
    expect(out.name).toBe('Ana "Aninha" Souza');
  });
  it("corpo vazio não quebra", () => {
    expect(parseBody("", null)).toEqual({});
  });
});

describe("parseLead", () => {
  it("aceita os nomes de variável da Leona e sugere a UF pelo DDD", () => {
    const res = parseLead({
      first_name: "Dioni",
      phone_number: "+55 11 95190-7539",
      ctwa_clid: "AfgzZR_exemplo",
      source_id: "120247299656290265",
      source_url: "https://www.instagram.com/p/XXXX/",
      thumbnail_url: "https://cdn/thumb.jpg?a=1&b=2",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.lead).toMatchObject({
      name: "Dioni",
      phone: "5511951907539",
      state: "SP",
      ctwa_clid: "AfgzZR_exemplo",
      source_id: "120247299656290265",
      thumbnail_url: "https://cdn/thumb.jpg?a=1&b=2",
    });
  });

  it("trata variável não preenchida como vazio", () => {
    const res = parseLead({
      name: "Ana",
      phone: "5588997057623",
      ctwa_clid: "{ctwa_clid}",
      source_id: "null",
      source_url: "",
      thumbnail_url: "{{thumbnail_url}}",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.lead.ctwa_clid).toBeNull();
    expect(res.lead.source_id).toBeNull();
    expect(res.lead.source_url).toBeNull();
    expect(res.lead.thumbnail_url).toBeNull();
    expect(res.lead.state).toBe("CE");
  });

  it("recusa sem telefone", () => {
    expect(parseLead({ name: "Ana" }).ok).toBe(false);
    expect(parseLead({ name: "Ana", phone: "{phone_number}" }).ok).toBe(false);
  });

  it("ignora maiúsculas nos nomes dos campos", () => {
    const res = parseLead({ Phone: "5511999998888", CTWA_CLID: "x1" });
    expect(res.ok && res.lead.ctwa_clid).toBe("x1");
  });
});

describe("mergeLead", () => {
  const incoming = (over = {}) => {
    const res = parseLead({ name: "Ana", phone: "5511999998888", ...over });
    if (!res.ok) throw new Error("teste inválido");
    return res.lead;
  };

  it("dado novo vazio não apaga o antigo", () => {
    const merged = mergeLead({ ctwa_clid: "antigo", source_id: "111", name: "Ana Souza" }, incoming());
    expect(merged.ctwa_clid).toBe("antigo");
    expect(merged.source_id).toBe("111");
  });

  it("clique novo substitui o antigo", () => {
    const merged = mergeLead({ ctwa_clid: "antigo", source_id: "111" }, incoming({ ctwa_clid: "novo", source_id: "222" }));
    expect(merged.ctwa_clid).toBe("novo");
    expect(merged.source_id).toBe("222");
  });

  it("cidade e estado corrigidos à mão são mantidos", () => {
    const merged = mergeLead({ city: "Campinas", state: "SP" }, incoming({ city: "Outra", state: "RJ" }));
    expect(merged.city).toBe("Campinas");
    expect(merged.state).toBe("SP");
  });

  it("lead novo recebe tudo que chegou", () => {
    const merged = mergeLead(null, incoming({ ctwa_clid: "c1" }));
    expect(merged).toMatchObject({ name: "Ana", phone: "5511999998888", ctwa_clid: "c1", state: "SP" });
  });
});
