import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus, Search, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatMoney, formatPhone } from "@/lib/format";
import { adsFor, listClients, listLeads, sentForLeads } from "@/lib/store";
import { eventLabel } from "@/lib/types";

const PAGE_SIZE = 50;

type Search = { cliente?: string; q?: string; filtro?: string; pagina?: string };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.pagina) || 1);
  const filtro = sp.filtro || "todos";
  const clients = await listClients();

  if (clients.length === 0) {
    return (
      <div className="card empty">
        <h1>Bem-Vindo ao Track Manual</h1>
        <p>
          Para começar, cadastre o primeiro cliente com o pixel, o token e o ID da Página. Depois é só importar os leads
          da Leona ou adicionar à mão.
        </p>
        <Button asChild>
          <Link href="/clientes/novo">
            <Plus />
            Cadastrar Primeiro Cliente
          </Link>
        </Button>
      </div>
    );
  }

  // Busca 1 a mais para saber se existe próxima página.
  const all = await listLeads({ clientId: sp.cliente || null, filter: filtro, q: sp.q, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE + 1 });
  const hasNext = all.length > PAGE_SIZE;
  const leads = all.slice(0, PAGE_SIZE);

  const [sentByLead, adByKey] = await Promise.all([
    sentForLeads(leads.map((l) => l.id)),
    adsFor(leads.filter((l) => l.source_id).map((l) => ({ clientId: l.client_id, adId: l.source_id! }))),
  ]);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));

  const pageLink = (p: number) => {
    const params = new URLSearchParams();
    if (sp.cliente) params.set("cliente", sp.cliente);
    if (sp.q) params.set("q", sp.q);
    if (sp.filtro) params.set("filtro", sp.filtro);
    if (p > 1) params.set("pagina", String(p));
    const s = params.toString();
    return s ? `/?${s}` : "/";
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Leads</h1>
          <p className="muted small">Abra um lead para conferir os dados e enviar o evento ao Meta.</p>
        </div>
        <div className="actions">
          <Button asChild variant="outline">
            <Link href="/leads/novo">
              <Plus />
              Adicionar à Mão
            </Link>
          </Button>
          <Button asChild>
            <Link href="/leads/importar">
              <Upload />
              Importar da Leona
            </Link>
          </Button>
        </div>
      </div>

      <form className="filters" method="get">
        <input name="q" placeholder="Buscar por nome, telefone ou ID do anúncio" defaultValue={sp.q || ""} />
        {clients.length > 1 && (
          <select name="cliente" defaultValue={sp.cliente || ""}>
            <option value="">Todos os Clientes</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <select name="filtro" defaultValue={filtro}>
          <option value="todos">Todos os Leads</option>
          <option value="com-ctwa">Só Com ctwa_clid</option>
          <option value="sem-ctwa">Só Sem ctwa_clid</option>
        </select>
        <Button variant="secondary" type="submit">
          <Search />
          Filtrar
        </Button>
      </form>

      <div className="card table-wrap">
        {leads.length === 0 ? (
          <p className="muted">
            Nenhum lead por aqui ainda. Exporte os contatos na Leona e importe o arquivo em <Link href="/leads/importar">Importar</Link>,
            ou adicione um lead à mão.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Lead</th>
                <th>Anúncio</th>
                <th>Rastreio</th>
                <th>Já Enviado</th>
                <th>Chegou Em</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => {
                const ad = lead.source_id ? adByKey.get(`${lead.client_id}:${lead.source_id}`) : undefined;
                const sent = sentByLead.get(lead.id) || [];
                return (
                  <tr key={lead.id}>
                    <td>
                      {lead.thumbnail_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="thumb" src={lead.thumbnail_url} alt="" loading="lazy" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="thumb-empty" />
                      )}
                    </td>
                    <td>
                      <Link href={`/leads/${lead.id}`}>
                        <strong>{lead.name || "Sem Nome"}</strong>
                      </Link>
                      <div className="muted small" style={{ whiteSpace: "nowrap" }}>
                        {formatPhone(lead.phone)}
                        {lead.state ? ` · ${lead.city ? `${lead.city}/` : ""}${lead.state}` : ""}
                        {clients.length > 1 ? ` · ${clientName.get(lead.client_id) || ""}` : ""}
                      </div>
                    </td>
                    <td>
                      {ad?.ad_name ? (
                        <>
                          <div>{ad.ad_name}</div>
                          <div className="muted small">{ad.campaign_name}</div>
                        </>
                      ) : lead.source_id ? (
                        <span className="mono">{lead.source_id}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      {lead.ctwa_clid ? (
                        <span className="badge badge-ok">Com ctwa_clid</span>
                      ) : (
                        <span className="badge badge-warn">Sem ctwa_clid</span>
                      )}
                    </td>
                    <td>
                      {sent.length === 0 ? (
                        <span className="muted small">Nada</span>
                      ) : (
                        sent.map((ev) => (
                          <div key={ev.id} className="small">
                            {eventLabel(ev.event_name)}
                            {ev.value ? ` · ${formatMoney(ev.value, ev.currency || "BRL")}` : ""}
                          </div>
                        ))
                      )}
                    </td>
                    <td className="small muted nowrap">{formatDateTime(lead.first_seen_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {(page > 1 || hasNext) && (
        <div className="actions">
          {page > 1 && (
            <Button asChild variant="outline" size="sm">
              <Link href={pageLink(page - 1)}>
                <ChevronLeft />
                Página Anterior
              </Link>
            </Button>
          )}
          {hasNext && (
            <Button asChild variant="outline" size="sm">
              <Link href={pageLink(page + 1)}>
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
