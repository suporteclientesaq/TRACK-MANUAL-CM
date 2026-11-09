import { describe, expect, it } from "vitest";
import {
  fetchAdAccountAdsAndInsights,
  fetchAdAccountCampaigns,
  fetchAdAccounts,
} from "@/lib/meta";
const token = "fixture-token-no-real-access";
const account = "act_123456789";
const options = {
  apiVersion: "v25.0",
  adAccountId: account,
  accessToken: token,
};
const campaign = (id: string, status = "ACTIVE") => ({
  id,
  name: `Campanha ${id}`,
  status,
  effective_status: status,
});
const response = (data: unknown[], paging?: unknown) =>
  new Response(JSON.stringify({ data, ...(paging ? { paging } : {}) }));
const ad = (id: string, campaignId = "1001", status = "PAUSED") => ({
  id,
  name: `Anúncio ${id}`,
  status,
  effective_status: status,
  campaign: campaign(campaignId),
  adset: {
    id: "3001",
    name: "Conjunto",
    status: "PAUSED",
    effective_status: "PAUSED",
  },
  insights: { data: [{ spend: "999", impressions: "10" }] },
});

describe("campanhas da conta Meta", () => {
  it("consulta campanhas ativas por padrão com status da própria campanha", async () => {
    const urls: URL[] = [];
    const result = await fetchAdAccountCampaigns({
      ...options,
      fetchImpl: async (raw) => {
        const url = new URL(raw);
        urls.push(url);
        return response([campaign("1001"), campaign("1002", "PAUSED")]);
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(urls[0].pathname).toBe(`/v25.0/${account}/campaigns`);
    expect(JSON.parse(urls[0].searchParams.get("effective_status")!)).toEqual([
      "ACTIVE",
    ]);
    expect(result.campaigns.map((item) => item.id)).toEqual(["1001"]);
    expect(result.partial).toBe(false);
  });
  it("paginação mantém o filtro e não para na primeira página", async () => {
    const urls: URL[] = [];
    const result = await fetchAdAccountCampaigns({
      ...options,
      campaignStatus: "paused",
      fetchImpl: async (raw) => {
        const url = new URL(raw);
        urls.push(url);
        return url.searchParams.has("after")
          ? response([campaign("1002", "PAUSED")])
          : response([campaign("1001", "PAUSED")], {
              next: `https://graph.facebook.com/v25.0/${account}/campaigns?after=second`,
              cursors: { after: "second" },
            });
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.campaigns).toHaveLength(2);
    expect(urls).toHaveLength(2);
    expect(urls[1].searchParams.get("effective_status")).toBe('["PAUSED"]');
    expect(urls[1].searchParams.get("access_token")).toBe(token);
  });
  it("all mantém pausadas sem inventar status de campanhas desconhecidas", async () => {
    const result = await fetchAdAccountCampaigns({
      ...options,
      campaignStatus: "all",
      fetchImpl: async (raw) => {
        expect(new URL(raw).searchParams.has("effective_status")).toBe(false);
        return response([
          campaign("1001"),
          campaign("1002", "PAUSED"),
          { id: "1003", name: "Sem status" },
        ]);
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.campaigns).toHaveLength(3);
      expect(result.campaigns[2].effective_status).toBeNull();
    }
  });
  it("não escolhe a primeira conta quando o token acessa várias contas", async () => {
    const urls: URL[] = [];
    const result = await fetchAdAccountAdsAndInsights({
      ...options,
      adAccountId: null,
      fetchImpl: async (raw) => {
        const url = new URL(raw);
        urls.push(url);
        return response([
          { id: "act_111", name: "Conta A" },
          { id: "act_222", name: "Conta B" },
        ]);
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Selecione explicitamente/);
    expect(urls).toHaveLength(1);
    expect(urls[0].searchParams.get("limit")).toBe("100");
  });
  it("recusa ID de conta malformado antes de consultar a Meta", async () => {
    let calls = 0;
    const result = await fetchAdAccountCampaigns({
      ...options,
      adAccountId: "act_123abc456",
      fetchImpl: async () => {
        calls++;
        return response([]);
      },
    });
    expect(result.ok).toBe(false);
    expect(calls).toBe(0);
  });
  it("interrompe paginação de origem externa sem encaminhar a credencial", async () => {
    const urls: URL[] = [];
    const result = await fetchAdAccountCampaigns({
      ...options,
      fetchImpl: async (raw) => {
        urls.push(new URL(raw));
        return response([campaign("1001")], {
          next: "https://example.invalid/steal?after=next",
          cursors: { after: "next" },
        });
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.partial).toBe(true);
      expect(result.warnings.join(" ")).toMatch(/origem/);
    }
    expect(urls).toHaveLength(1);
    expect(urls[0].hostname).toBe("graph.facebook.com");
  });
  it("lista contas paginadas sem presumir que a lista inicial é completa", async () => {
    const result = await fetchAdAccounts({
      apiVersion: "v25.0",
      accessToken: token,
      fetchImpl: async (raw) =>
        new URL(raw).searchParams.has("after")
          ? response([
              {
                id: "act_222",
                name: "B",
                account_id: "222",
                account_status: 1,
              },
            ])
          : response([{ id: "act_111", name: "A" }], {
              next: "https://graph.facebook.com/v25.0/me/adaccounts?after=next",
              cursors: { after: "next" },
            }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.accounts.map((item) => item.id)).toEqual([
        "act_111",
        "act_222",
      ]);
      expect(result.partial).toBe(false);
    }
  });
});

describe("sincronização restrita às campanhas escolhidas", () => {
  it("filtra anúncios por IDs de campanha e mantém anúncio pausado de campanha ativa", async () => {
    const urls: URL[] = [];
    const result = await fetchAdAccountAdsAndInsights({
      ...options,
      fetchImpl: async (raw) => {
        const url = new URL(raw);
        urls.push(url);
        return url.pathname.endsWith("/campaigns")
          ? response([campaign("1001")])
          : response([ad("2001")]);
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(urls[1].searchParams.get("filtering")!)).toEqual([
      { field: "campaign.id", operator: "IN", value: ["1001"] },
    ]);
    expect(result.ads).toHaveLength(1);
    expect(result.ads[0].ad_status).toBe("PAUSED");
    expect(result.ads[0].raw).toMatchObject({
      account_id: account,
      item: {
        campaign: { effective_status: "ACTIVE" },
        adset: { effective_status: "PAUSED" },
      },
    });
  });
  it("não amplia a busca quando uma seleção deixou de estar ativa", async () => {
    let calls = 0;
    const result = await fetchAdAccountAdsAndInsights({
      ...options,
      campaignIds: ["1002"],
      fetchImpl: async () => {
        calls++;
        return response([campaign("1001")]);
      },
    });
    expect(result.ok).toBe(false);
    expect(calls).toBe(1);
  });
  it("seleção explícita exclui as demais campanhas ativas da requisição de anúncios", async () => {
    const result = await fetchAdAccountAdsAndInsights({
      ...options,
      campaignIds: ["1002"],
      fetchImpl: async (raw) => {
        const url = new URL(raw);
        if (url.pathname.endsWith("/campaigns"))
          return response([campaign("1001"), campaign("1002")]);
        expect(JSON.parse(url.searchParams.get("filtering")!)[0].value).toEqual(
          ["1002"],
        );
        return response([ad("2002", "1002")]);
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.ads.map((item) => item.campaign_id)).toEqual(["1002"]);
  });
  it("consulta todas as páginas de anúncios preservando seleção e deduplicando IDs", async () => {
    const requests: URL[] = [];
    const result = await fetchAdAccountAdsAndInsights({
      ...options,
      fetchImpl: async (raw) => {
        const url = new URL(raw);
        requests.push(url);
        if (url.pathname.endsWith("/campaigns"))
          return response([campaign("1001")]);
        if (url.searchParams.has("after"))
          return response([ad("2001"), ad("2002")]);
        return response([ad("2001")], {
          next: `https://graph.facebook.com/v25.0/${account}/ads?after=next`,
          cursors: { after: "next" },
        });
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ads).toHaveLength(2);
      expect(result.partial).toBe(false);
    }
    expect(requests[2].searchParams.get("filtering")).toBe(
      requests[1].searchParams.get("filtering"),
    );
  });
  it("falha após primeira página permanece visível como resultado parcial", async () => {
    const result = await fetchAdAccountAdsAndInsights({
      ...options,
      fetchImpl: async (raw) => {
        const url = new URL(raw);
        if (url.pathname.endsWith("/campaigns"))
          return response([campaign("1001")]);
        if (url.searchParams.has("after"))
          throw new Error("Falha de rede controlada");
        return response([ad("2001")], {
          next: `https://graph.facebook.com/v25.0/${account}/ads?after=next`,
          cursors: { after: "next" },
        });
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ads).toHaveLength(1);
      expect(result.partial).toBe(true);
      expect(result.warnings.join(" ")).toMatch(/interrompida/);
    }
  });
  it("resposta indevida fora da seleção não contamina o cache sincronizado", async () => {
    const result = await fetchAdAccountAdsAndInsights({
      ...options,
      fetchImpl: async (raw) =>
        new URL(raw).pathname.endsWith("/campaigns")
          ? response([campaign("1001")])
          : response([ad("2001"), ad("2002", "9999")]),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ads).toHaveLength(1);
      expect(result.partial).toBe(true);
    }
  });
});
