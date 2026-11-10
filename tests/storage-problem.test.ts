import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StorageProblem } from "@/app/StorageProblem";
import { explainDatabaseError } from "@/lib/db-url";

const custom =
  "postgresql://usr:PrivatePassword123@db.yousecure.io:5437/customdb?access_token=query-secret";
const render = (message: string, database: string, sql?: string) =>
  renderToStaticMarkup(
    createElement(StorageProblem, { message, database, sql }),
  );

describe("tela de conexão por provedor", () => {
  it("mantém o endpoint personalizado e mostra a configuração de CA sem recomendar migração", () => {
    const message = explainDatabaseError(
      new Error("self-signed certificate"),
      custom,
    );
    const html = render(message, custom);
    expect(html).toContain("db.yousecure.io:5437/customdb");
    expect(html).toContain("DATABASE_SSL_CA");
    expect(html).toContain("recrie o contêiner do Track Manual");
    expect(html).not.toMatch(/Supabase|supabase|pooler|6543|Netlify/);
    expect(html).not.toContain("PrivatePassword123");
    expect(html).not.toContain("query-secret");
  });

  it("mostra a orientação específica quando o endereço é do Supabase", () => {
    const html = render(
      "Não conectou.",
      "postgresql://postgres.project:password@aws-0-sa-east-1.pooler.supabase.com:6543/postgres",
    );
    expect(html).toContain("Este endereço é do Supabase");
    expect(html).toContain("Transaction pooler");
    expect(html).not.toContain(":password@");
  });

  it("preserva o fluxo SQL da API Supabase com endereço sem query sensível", () => {
    const html = render(
      "Faltam as tabelas.",
      "https://project.supabase.co?apikey=query-secret",
      "select 1;",
    );
    expect(html).toContain("SQL Editor");
    expect(html).toContain("select 1;");
    expect(html).not.toContain("query-secret");
  });

  it("redige uma URI que reaparece na mensagem do driver", () => {
    const html = render("Falha: " + custom, custom);
    expect(html).not.toContain("PrivatePassword123");
    expect(html).not.toContain("query-secret");
  });
});
