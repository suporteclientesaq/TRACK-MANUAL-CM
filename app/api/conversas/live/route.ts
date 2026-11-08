import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { listLeads, getLead, adsFor, sentForLeads } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAuth();
    const url = new URL(req.url);
    const clientId = url.searchParams.get("cliente") || null;
    const q = url.searchParams.get("q") || undefined;
    const requestedLeadId = url.searchParams.get("lead") || null;

    let leads = await listLeads({
      clientId,
      q,
      offset: 0,
      limit: 1000,
    });

    // Se um lead específico foi solicitado, garante que ele sempre esteja na lista
    if (requestedLeadId && !leads.some((l) => l.id === requestedLeadId)) {
      const single = await getLead(requestedLeadId);
      if (single) {
        leads = [single, ...leads];
      }
    }

    const [sentByLead, adByKey] = await Promise.all([
      sentForLeads(leads.map((l) => l.id)),
      adsFor(
        leads
          .filter((l) => l.source_id)
          .map((l) => ({ clientId: l.client_id, adId: l.source_id! }))
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

    return NextResponse.json({
      ok: true,
      leads,
      adsData,
      eventsData,
      timestamp: Date.now(),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
