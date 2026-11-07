import { listClients, listLeads, adsFor, sentForLeads } from "@/lib/store";
import { ConversasClient } from "./ConversasClient";

export const dynamic = "force-dynamic";

interface SearchParams {
  cliente?: string;
  lead?: string;
  q?: string;
}

export default async function ConversasPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const clients = await listClients();

  // Busca até 200 leads recentes para a central de conversas
  const leads = await listLeads({
    clientId: sp.cliente || null,
    q: sp.q,
    offset: 0,
    limit: 200,
  });

  const [sentByLead, adByKey] = await Promise.all([
    sentForLeads(leads.map((l) => l.id)),
    adsFor(
      leads
        .filter((l) => l.source_id)
        .map((l) => ({ clientId: l.client_id, adId: l.source_id! }))
    ),
  ]);

  const clientNameMap: Record<string, string> = {};
  for (const c of clients) {
    clientNameMap[c.id] = c.name;
  }

  // Prepara anúncios serializáveis para o cliente
  const adsData: Record<string, any> = {};
  for (const [k, v] of adByKey.entries()) {
    adsData[k] = v;
  }

  // Prepara eventos serializáveis por lead
  const eventsData: Record<string, any[]> = {};
  for (const [leadId, evs] of sentByLead.entries()) {
    eventsData[leadId] = evs;
  }

  return (
    <ConversasClient
      clients={clients.map((c) => ({ id: c.id, name: c.name, default_currency: c.default_currency }))}
      initialLeads={leads}
      adsData={adsData}
      eventsData={eventsData}
      clientNameMap={clientNameMap}
      initialSelectedLeadId={sp.lead || leads[0]?.id || null}
      initialClientId={sp.cliente || ""}
      initialSearchQuery={sp.q || ""}
    />
  );
}
