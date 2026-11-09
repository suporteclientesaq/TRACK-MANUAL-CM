import { NextResponse, type NextRequest } from "next/server";
import { isLoggedIn } from "@/lib/auth";
import { listClients, listLeads, sentForLeads } from "@/lib/store";
import { csvCell } from "@/lib/export-csv";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  if (!(await isLoggedIn()))
    return NextResponse.json(
      { ok: false, error: "Autenticação necessária." },
      { status: 401 },
    );
  const params = req.nextUrl.searchParams;
  const clientId = params.get("cliente") || null;
  const filter = params.get("filtro") || "todos";
  const q = params.get("q") || undefined;
  const names = new Map(
    (await listClients()).map((client) => [client.id, client.name]),
  );
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(
          encoder.encode(
            "\uFEFF" +
              [
                "Nome",
                "Telefone",
                "Email",
                "Cidade",
                "Estado",
                "Cliente",
                "ID do anúncio",
                "CTWA recebido",
                "Compra recebida Meta",
                "Primeiro contato",
              ]
                .map(csvCell)
                .join(";") +
              "\r\n",
          ),
        );
        let offset = 0;
        while (true) {
          const leads = await listLeads({
            clientId,
            filter,
            q,
            offset,
            limit: 500,
          });
          if (!leads.length) break;
          const events = await sentForLeads(leads.map((lead) => lead.id));
          const lines =
            leads
              .map((lead) =>
                [
                  lead.name,
                  lead.phone,
                  lead.email,
                  lead.city,
                  lead.state,
                  names.get(lead.client_id),
                  lead.source_id,
                  !!lead.ctwa_clid && !lead.ctwa_clid.startsWith("ctwa_ad_")
                    ? "Sim"
                    : "Não",
                  (events.get(lead.id) || []).some(
                    (event) =>
                      event.event_name === "Purchase" &&
                      !event.is_test &&
                      event.status === "enviado",
                  )
                    ? "Sim"
                    : "Não",
                  lead.first_seen_at,
                ]
                  .map(csvCell)
                  .join(";"),
              )
              .join("\r\n") + "\r\n";
          controller.enqueue(encoder.encode(lines));
          offset += leads.length;
          if (leads.length < 500) break;
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="track-manual-contatos.csv"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
