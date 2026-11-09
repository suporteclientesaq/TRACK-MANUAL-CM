import { NextResponse, type NextRequest } from "next/server";
import { isLoggedIn } from "@/lib/auth";
import { listLeads, getLead, adsFor, sentForLeads } from "@/lib/store";
import { createHash } from "node:crypto";
import { summarizeConversation } from "@/app/(painel)/conversas/conversation-data";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    if (!(await isLoggedIn()))
      return NextResponse.json(
        { ok: false, error: "Sua sessão expirou. Entre novamente." },
        { status: 401 },
      );
    const url = new URL(req.url);
    const clientId = url.searchParams.get("cliente") || null;
    const q = url.searchParams.get("q") || undefined;
    const requestedLeadId = url.searchParams.get("lead") || null;
    const compact = url.searchParams.get("summary") === "1";
    const numberParam = (name: string, fallback: number, max: number) => {
      const value = Number(url.searchParams.get(name));
      return Number.isFinite(value) && value >= 0 && url.searchParams.has(name)
        ? Math.min(max, Math.floor(value))
        : fallback;
    };
    const offset = numberParam("offset", 0, 100000);
    const limit = Math.max(1, numberParam("limit", compact ? 100 : 1000, 1000));
    const messageLimit = Math.max(20, numberParam("message_limit", 100, 1000));

    let leads = await listLeads({
      clientId,
      q,
      offset,
      limit: limit + 1,
    });
    const hasMore = leads.length > limit;
    leads = leads.slice(0, limit);

    // Se um lead específico foi solicitado, garante que ele sempre esteja na lista
    if (requestedLeadId && !leads.some((l) => l.id === requestedLeadId)) {
      const single = await getLead(requestedLeadId);
      if (single && (!clientId || single.client_id === clientId)) {
        leads = [single, ...leads];
      }
    }

    const [sentByLead, adByKey] = await Promise.all([
      sentForLeads(leads.map((l) => l.id)),
      adsFor(
        leads
          .filter((l) => l.source_id)
          .map((l) => ({ clientId: l.client_id, adId: l.source_id! })),
      ),
    ]);

    const adsData: Record<string, any> = {};
    for (const [k, v] of adByKey.entries()) {
      adsData[k] = v;
    }

    const eventsData: Record<string, any[]> = {};
    for (const [leadId, evs] of sentByLead.entries()) {
      eventsData[leadId] = evs;
    }

    const response = {
      ok: true,
      leads: compact
        ? leads.map((lead) =>
            summarizeConversation(
              lead,
              lead.id === requestedLeadId,
              messageLimit,
            ),
          )
        : leads,
      adsData,
      eventsData,
      hasMore,
    };
    const etag = `"${createHash("sha256").update(JSON.stringify(response)).digest("hex")}"`;
    const headers = { "Cache-Control": "private, no-cache", ETag: etag };
    if (req.headers.get("if-none-match") === etag)
      return new NextResponse(null, { status: 304, headers });
    return NextResponse.json(
      { ...response, timestamp: Date.now() },
      { headers },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 },
    );
  }
}
