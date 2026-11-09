import {
  listClients,
  listLeads,
  getLead,
  adsFor,
  sentForLeads,
  getSetting,
} from "@/lib/store";
import { ConversasClient } from "./ConversasClient";
import { summarizeConversation } from "./conversation-data";

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

  // Busca todos os leads recentes para a central de conversas (limite ampliado para 1000)
  let leads = await listLeads({
    clientId: sp.cliente || null,
    q: sp.q,
    offset: 0,
    limit: 101,
  });
  const hasMore = leads.length > 100;
  leads = leads.slice(0, 100);

  // Se a URL solicitou um lead específico, garante que ele sempre esteja na lista
  if (sp.lead && !leads.some((l) => l.id === sp.lead)) {
    const single = await getLead(sp.lead);
    if (single && (!sp.cliente || single.client_id === sp.cliente)) {
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
      clients={clients.map((c) => ({
        id: c.id,
        name: c.name,
        default_currency: c.default_currency,
      }))}
      initialLeads={leads.map((lead) =>
        summarizeConversation(lead, lead.id === (sp.lead || leads[0]?.id)),
      )}
      adsData={adsData}
      eventsData={eventsData}
      clientNameMap={clientNameMap}
      initialSelectedLeadId={sp.lead || leads[0]?.id || null}
      initialClientId={sp.cliente || ""}
      initialSearchQuery={sp.q || ""}
      initialOpenThread={Boolean(sp.lead)}
      initialHasMore={hasMore}
      initialUpdatedAt={new Date().toISOString()}
      initialSoundEnabled={
        (await getSetting("sound_notifications")) !== "false"
      }
      initialBadgeEnabled={
        (await getSetting("tab_badge_notifications")) !== "false"
      }
    />
  );
}
