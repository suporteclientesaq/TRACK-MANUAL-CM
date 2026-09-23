import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatMoney, formatPhone } from "@/lib/format";
import { listEvents, recentSent } from "@/lib/store";
import { eventLabel } from "@/lib/types";

const PAGE_SIZE = 50;

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; pagina?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.pagina) || 1);

  const all = await listEvents({ status: sp.status, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE + 1 });
  const hasNext = all.length > PAGE_SIZE;
  const events = all.slice(0, PAGE_SIZE);

  // Totais do que foi recebido de verdade (sem testes) nos últimos 30 dias.
  const recent = await recentSent(new Date(Date.now() - 30 * 86_400_000).toISOString());
  const purchases = recent.filter((e) => e.event_name === "Purchase");
  const revenue = purchases.reduce((sum, e) => sum + (e.value || 0), 0);

  const link = (p: number, status = sp.status) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (p > 1) params.set("pagina", String(p));
    const s = params.toString();
    return s ? `/eventos?${s}` : "/eventos";
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Eventos Enviados</h1>
          <p className="muted small">
            Últimos 30 dias: {recent.length} evento(s) recebido(s) pelo Meta, {purchases.length} compra(s),{" "}
            {formatMoney(revenue)} em valor enviado.
          </p>
        </div>
        <div className="seg" role="group" aria-label="Filtro">
          {[
            { value: "", label: "Todos" },
            { value: "enviado", label: "Recebidos" },
            { value: "erro", label: "Com Erro" },
          ].map((f) => (
            <Button key={f.value} asChild variant={(sp.status || "") === f.value ? "outline" : "ghost"} size="sm">
              <Link href={link(1, f.value)}>{f.label}</Link>
            </Button>
          ))}
        </div>
      </div>

      <div className="card table-wrap">
        {events.length === 0 ? (
          <p className="muted">Nenhum evento por aqui.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Enviado Em</th>
                <th>Lead</th>
                <th>Evento</th>
                <th>Valor</th>
                <th>Resultado</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id}>
                  <td className="small nowrap">{formatDateTime(ev.created_at)}</td>
                  <td>
                    <Link href={`/leads/${ev.lead_id}`}>{ev.lead_name || "Sem Nome"}</Link>
                    <div className="muted small">
                      {formatPhone(ev.lead_phone)} · {ev.client_name}
                    </div>
                  </td>
                  <td>
                    {eventLabel(ev.event_name)} {ev.is_test && <span className="badge badge-warn">Teste</span>}
                    {ev.action_source !== "business_messaging" && <div className="muted small">sem ctwa_clid</div>}
                  </td>
                  <td>{formatMoney(ev.value, ev.currency || "BRL")}</td>
                  <td>
                    {ev.status === "enviado" ? (
                      <span className="badge badge-ok">Recebido Pelo Meta</span>
                    ) : (
                      <>
                        <span className="badge badge-err">Erro</span>
                        <div className="small">{ev.error_message}</div>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {(page > 1 || hasNext) && (
        <div className="actions">
          {page > 1 && (
            <Button asChild variant="outline" size="sm">
              <Link href={link(page - 1)}>
                <ChevronLeft />
                Página Anterior
              </Link>
            </Button>
          )}
          {hasNext && (
            <Button asChild variant="outline" size="sm">
              <Link href={link(page + 1)}>
                Próxima Página
                <ChevronRight />
              </Link>
            </Button>
          )}
        </div>
      )}
    </>
  );
}
