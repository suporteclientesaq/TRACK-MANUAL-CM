import { listClients, listLeads, sentForLeads } from "@/lib/store";
import { stageFor } from "@/lib/pipeline";
import { PipelineBoard } from "./PipelineBoard";
export const dynamic = "force-dynamic";
export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string }>;
}) {
  const { cliente } = await searchParams;
  const [clients, rows] = await Promise.all([
    listClients(),
    listLeads({ clientId: cliente || null, offset: 0, limit: 201 }),
  ]);
  const hasMore = rows.length > 200;
  const leads = rows.slice(0, 200);
  const events = await sentForLeads(leads.map((lead) => lead.id));
  const names = new Map(clients.map((client) => [client.id, client.name]));
  return (
    <PipelineBoard
      clients={clients.map(({ id, name }) => ({ id, name }))}
      clientId={cliente || ""}
      hasMore={hasMore}
      initialCards={leads.map((lead) => {
        const purchases = (events.get(lead.id) || []).filter(
          (event) =>
            event.event_name === "Purchase" &&
            !event.is_test &&
            event.status === "enviado",
        );
        return {
          id: lead.id,
          name: lead.name || lead.phone,
          phone: lead.phone,
          company: names.get(lead.client_id) || "Cliente",
          clientId: lead.client_id,
          stage: stageFor(lead, events.get(lead.id) || []),
          ad: !!lead.source_id,
          notes: lead.notes,
          updatedAt: lead.updated_at,
          revenue: purchases.reduce(
            (sum, event) => sum + (event.value || 0),
            0,
          ),
          currency: purchases[0]?.currency || "BRL",
          hasPurchase: purchases.length > 0,
        };
      })}
    />
  );
}
