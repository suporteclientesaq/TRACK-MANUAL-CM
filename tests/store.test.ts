import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Os mesmos testes rodam contra os três modos:
 *  - SQLite: sempre, numa pasta temporária.
 *  - Postgres: só quando TEST_DATABASE_URL está definida (banco de teste real).
 *  - API do Supabase: só com TEST_SUPABASE_URL + TEST_SUPABASE_KEY (PostgREST real)
 *    e TEST_SUPABASE_PG_URL (o mesmo banco, por baixo, para criar as tabelas).
 * O modo é escolhido antes de importar o store, porque ele lê o ambiente.
 */
const PG_URL = (process.env.TEST_DATABASE_URL || "").trim();
const REST_URL = (process.env.TEST_SUPABASE_URL || "").trim();
const REST_KEY = (process.env.TEST_SUPABASE_KEY || "").trim();
const REST_PG_URL = (process.env.TEST_SUPABASE_PG_URL || "").trim();
type Mode = "sqlite" | "postgres" | "supabase-rest";
const modes: Mode[] = ["sqlite"];
if (PG_URL) modes.push("postgres");
if (REST_URL && REST_KEY && REST_PG_URL) modes.push("supabase-rest");

for (const mode of modes) {
  describe(`banco (${mode})`, () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "track-manual-test-"));
    let store: typeof import("@/lib/store");
    let config: typeof import("@/lib/config");
    let ingest: typeof import("@/lib/ingest");
    let clientId = "";

    beforeAll(async () => {
      process.env.TRACK_DATA_DIR = tmp;
      delete process.env.DATABASE_URL;
      delete process.env.SUPABASE_DATABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (mode === "postgres") process.env.DATABASE_URL = PG_URL;
      if (mode === "supabase-rest") {
        process.env.SUPABASE_DATABASE_URL = REST_URL;
        process.env.SUPABASE_SERVICE_ROLE_KEY = REST_KEY;
      }
      // isolamento entre os modos: módulos novos a cada describe
      const { vi } = await import("vitest");
      vi.resetModules();
      store = await import("@/lib/store");
      config = await import("@/lib/config");
      ingest = await import("@/lib/ingest");
      if (mode === "postgres" || mode === "supabase-rest") {
        // limpa o banco de teste; no modo API também cria as tabelas (como a pessoa faria no SQL Editor)
        const { Pool } = await import("pg");
        const { normalizeDatabaseUrl } = await import("@/lib/db-url");
        const p = new Pool({ connectionString: normalizeDatabaseUrl(mode === "postgres" ? PG_URL : REST_PG_URL) });
        await p.query("drop table if exists events, ad_cache, leads, clients, settings cascade");
        if (mode === "supabase-rest") {
          const { SUPABASE_SETUP_SQL } = await import("@/lib/schema-sql");
          await p.query(SUPABASE_SETUP_SQL);
          // o PostgREST recarrega o cache ao receber o notify; dá um instante para isso
          await new Promise((r) => setTimeout(r, 400));
        }
        await p.end();
      }
      expect(store.storeKind()).toBe(mode);
      clientId = await store.insertClient({ name: "Continental MKT", pixel_id: "1704000000002274", page_id: "111" });
    });

    afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

    it("cliente ganha chave de webhook e é encontrado por ela", async () => {
      const c = (await store.getClient(clientId))!;
      expect(c.webhook_key).toMatch(/^[a-f0-9]{48}$/);
      expect((await store.getClientByWebhookKey(c.webhook_key))?.id).toBe(clientId);
      expect(c.send_extra_data).toBe(true);
      expect(c.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("atualiza só as colunas permitidas", async () => {
      await store.updateClient(clientId, { name: "Continental", webhook_key: "hack", id: "x", send_extra_data: false });
      const c = (await store.getClient(clientId))!;
      expect(c.name).toBe("Continental");
      expect(c.webhook_key).toMatch(/^[a-f0-9]{48}$/);
      expect(c.send_extra_data).toBe(false);
    });

    it("lead: cria, atualiza pelo telefone, não duplica", async () => {
      const a = await ingest.ingestLead(clientId, { name: "Dioni Santana 🥰", phone: "557481461611", ctwa_clid: "AbC" }, "leona", { x: 1 });
      expect(a.ok && a.created).toBe(true);
      const b = await ingest.ingestLead(clientId, { name: "Dioni", phone: "+55 74 8146-1611", ctwa_clid: "{ctwa_clid}" }, "manual");
      expect(b.ok && !b.created).toBe(true);
      const lead = (await store.findLead(clientId, "557481461611"))!;
      expect(lead.ctwa_clid).toBe("AbC");
      expect(lead.name).toBe("Dioni");
      expect(lead.state).toBe("BA");
      expect(lead.raw).toEqual({ x: 1 });
      expect(lead.origin).toBe("leona");
      expect(lead.clid_seen_at).toMatch(/^\d{4}-/);
    });

    it("inserção direta com o mesmo telefone é recusada", async () => {
      let err: unknown = null;
      try {
        await store.insertLead({ client_id: clientId, phone: "557481461611", origin: "manual" });
      } catch (e) {
        err = e;
      }
      expect(err).not.toBeNull();
      expect(store.isUniqueViolation(err)).toBe(true);
    });

    it("importação em lote: novos, atualizados, repetidos no arquivo e sem telefone", async () => {
      const r = await ingest.ingestMany(clientId, [
        { nome: "Sem Clique", telefone: "5588997057623" },
        { nome: "Dioni Nova", telefone: "557481461611", ctwa_clid: "" },
        { nome: "Repetido 1", telefone: "5511999998888", ctwa_clid: "primeiro" },
        { nome: "Repetido 2", telefone: "5511999998888", ctwa_clid: "segundo" },
        { nome: "Sem Telefone" },
      ]);
      expect(r).toMatchObject({ total: 5, created: 2, updated: 1, skipped: 1 });
      expect(r.problems[0]).toMatch(/Linha 6/);
      const dioni = (await store.findLead(clientId, "557481461611"))!;
      expect(dioni.name).toBe("Dioni Nova");
      expect(dioni.ctwa_clid).toBe("AbC"); // coluna vazia não apaga
      expect(dioni.raw).toEqual({ x: 1 }); // lote não mexe no bruto
      const rep = (await store.findLead(clientId, "5511999998888"))!;
      expect(rep.name).toBe("Repetido 2");
      expect(rep.ctwa_clid).toBe("segundo");
      expect(rep.clid_seen_at).toMatch(/^\d{4}-/);
      expect((await store.findLeadsByPhones(clientId, ["5588997057623", "5511999998888", "000"])).length).toBe(2);
    });

    it("lista com busca e filtro", async () => {
      const phones = (f: Parameters<typeof store.listLeads>[0]) => store.listLeads(f).then((ls) => ls.map((l) => l.phone).sort());
      expect(await phones({ filter: "com-ctwa", offset: 0, limit: 10 })).toEqual(["5511999998888", "557481461611"]);
      expect(await phones({ filter: "sem-ctwa", offset: 0, limit: 10 })).toEqual(["5588997057623"]);
      expect(await store.listLeads({ q: "8146", offset: 0, limit: 10 })).toHaveLength(1);
      expect(await store.listLeads({ q: "dioni", offset: 0, limit: 10 })).toHaveLength(1);
      expect(await store.listLeads({ q: "DIONI", offset: 0, limit: 10 })).toHaveLength(1);
      expect(await store.listLeads({ q: "100%", offset: 0, limit: 10 })).toHaveLength(0);
      expect(await store.listLeads({ offset: 0, limit: 1 })).toHaveLength(1);
      expect(await store.listLeads({ clientId: "outro", offset: 0, limit: 10 })).toHaveLength(0);
    });

    it("eventos: grava, conta enviados e faz o join com nomes", async () => {
      const lead = (await store.findLead(clientId, "557481461611"))!;
      const id = await store.insertEvent({
        client_id: clientId, lead_id: lead.id, event_name: "Purchase", event_id: "e1", event_time: new Date().toISOString(),
        value: 29.9, currency: "BRL", content_name: "3 - FOTOS", action_source: "business_messaging", is_test: false,
        status: "enviado", http_status: 200, events_received: 1, fbtrace_id: "T", error_message: null,
        payload: { data: [{ a: 1 }] }, response: { events_received: 1 },
      });
      await store.insertEvent({
        client_id: clientId, lead_id: lead.id, event_name: "Purchase", event_id: "e2", event_time: new Date().toISOString(),
        value: 29.9, currency: "BRL", content_name: null, action_source: "business_messaging", is_test: true,
        status: "enviado", http_status: 200, events_received: 1, fbtrace_id: null, error_message: null, payload: {}, response: null,
      });
      expect(await store.countSent(lead.id, "Purchase")).toBe(1); // o de teste não conta
      const ev = (await store.getEvent(id))!;
      expect(ev.payload).toEqual({ data: [{ a: 1 }] });
      expect(ev.is_test).toBe(false);
      expect(ev.value).toBe(29.9);
      const list = await store.listEvents({ offset: 0, limit: 10 });
      expect(list).toHaveLength(2);
      expect(list[0].lead_name).toBe("Dioni Nova");
      expect(list[0].client_name).toBe("Continental");
      expect(await store.listEvents({ status: "erro", offset: 0, limit: 10 })).toHaveLength(0);
      expect((await store.sentForLeads([lead.id])).get(lead.id)).toHaveLength(1);
      expect(await store.recentSent(new Date(Date.now() - 60_000).toISOString())).toEqual([{ event_name: "Purchase", value: 29.9 }]);
      expect(await store.contentNames(clientId)).toEqual(["3 - FOTOS"]);
    });

    it("cache do anúncio: insere e atualiza", async () => {
      await store.upsertAd({ client_id: clientId, ad_id: "120", ad_name: "AD 1", spend: 10 });
      await store.upsertAd({ client_id: clientId, ad_id: "120", ad_name: "AD 1 novo", spend: 12.5, impressions: 10432, raw: { k: 1 } });
      const ad = (await store.getAd(clientId, "120"))!;
      expect(ad.ad_name).toBe("AD 1 novo");
      expect(ad.spend).toBe(12.5);
      expect(ad.impressions).toBe(10432);
      expect(ad.raw).toEqual({ k: 1 });
      expect((await store.adsFor([{ clientId, adId: "120" }])).size).toBe(1);
    });

    it("configuração: segredo gerado sozinho e senha com hash", async () => {
      const secret = await config.appSecret();
      expect(secret).toMatch(/^[a-f0-9]{64}$/);
      expect(await config.appSecret()).toBe(secret);
      expect(await config.hasPassword()).toBe(false);
      await config.setPassword("minha senha");
      expect(await config.hasPassword()).toBe(true);
      expect(await config.verifyPassword("minha senha")).toBe(true);
      expect(await config.verifyPassword("outra")).toBe(false);
      if (mode === "sqlite") {
        const raw = fs.readFileSync(path.join(tmp, "config.json"), "utf8");
        expect(raw).not.toContain("minha senha");
      } else {
        expect(await store.getSetting("password_hash")).not.toContain("minha senha");
        expect(await store.getSetting("app_secret")).toBe(secret);
      }
    });

    it("apagar o lead leva os eventos junto", async () => {
      const lead = (await store.findLead(clientId, "557481461611"))!;
      await store.deleteLead(lead.id);
      expect(await store.getLead(lead.id)).toBeNull();
      expect(await store.listEventsForLead(lead.id)).toHaveLength(0);
      expect((await store.stats()).leads).toBe(2);
    });
  });
}
