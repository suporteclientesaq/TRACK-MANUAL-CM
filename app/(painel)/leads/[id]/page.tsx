import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteLeadAction, resendEventAction } from "@/app/actions";
import { daysSince, formatDateTime, formatMoney, formatNumber, formatPhone } from "@/lib/format";
import { contentNames, getAd, getClient, getLead, listClients, listEventsForLead } from "@/lib/store";
import { eventLabel } from "@/lib/types";
import { LeadForm } from "../LeadForm";
import { RefreshAdButton } from "./RefreshAdButton";
import { SendEventForm } from "./SendEventForm";

export default async function LeadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ salvo?: string }>;
}) {
  const { id } = await params;
  const { salvo } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const lead = await getLead(id);
  if (!lead) notFound();
  const [client, clientsData, events, ad, products] = await Promise.all([
    getClient(lead.client_id),
    listClients(),
    listEventsForLead(lead.id),
    lead.source_id ? getAd(lead.client_id, lead.source_id) : Promise.resolve(null),
    contentNames(lead.client_id),
  ]);
  const clidAge = daysSince(lead.clid_seen_at);
  const thumb = lead.thumbnail_url || ad?.thumbnail_url;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{lead.name || "Sem Nome"}</h1>
          <p className="muted small">
            {formatPhone(lead.phone)} · {client?.name} · chegou em {formatDateTime(lead.first_seen_at)}{" "}
            {lead.origin === "leona" ? "pela Leona" : "(importado ou adicionado à mão)"}
          </p>
        </div>
        <Link className="btn" href="/">
          Voltar aos Leads
        </Link>
      </div>

      {salvo && <div className="note note-ok">Alterações salvas.</div>}

      <div className="grid-2">
        <div>
          <div className="card">
            <h2>Origem do Anúncio</h2>
            {lead.ctwa_clid ? (
              <p>
                <span className="badge badge-ok">Com ctwa_clid</span>{" "}
                {clidAge !== null && <span className="muted small">clique registrado há {clidAge} dia(s)</span>}
              </p>
            ) : (
              <div className="note note-warn">
                Este lead não tem ctwa_clid. O evento pode ser enviado, mas o Meta casa só pelo telefone e pode não
                atribuir ao anúncio.
              </div>
            )}
            {clidAge !== null && clidAge > 7 && (
              <div className="note note-warn">
                O clique tem mais de 7 dias. A janela padrão de atribuição do Meta é de 7 dias após o clique: o evento é
                aceito, mas pode não aparecer como resultado do anúncio.
              </div>
            )}
            {thumb && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="thumb-lg" src={thumb} alt="Miniatura do anúncio" referrerPolicy="no-referrer" style={{ marginBottom: 12 }} />
            )}
            <dl className="data">
              <dt>CTWA Click ID</dt>
              <dd className="mono">{lead.ctwa_clid || "—"}</dd>
              <dt>ID de Origem</dt>
              <dd className="mono">{lead.source_id || "—"}</dd>
              <dt>URL de Origem</dt>
              <dd className="mono">
                {lead.source_url ? (
                  <a href={lead.source_url} target="_blank" rel="noreferrer noopener">
                    {lead.source_url}
                  </a>
                ) : (
                  "—"
                )}
              </dd>
              <dt>URL da Miniatura</dt>
              <dd className="mono">{lead.thumbnail_url ? `${lead.thumbnail_url.slice(0, 70)}…` : "—"}</dd>
              <dt>URL da Mídia</dt>
              <dd className="mono">{lead.media_url ? `${lead.media_url.slice(0, 70)}…` : "—"}</dd>
              <dt>Local</dt>
              <dd>{[lead.city, lead.state].filter(Boolean).join(" / ") || "—"}</dd>
            </dl>
          </div>

          <div className="card">
            <h2>Dados do Anúncio no Meta</h2>
            {ad ? (
              <dl className="data" style={{ marginBottom: 12 }}>
                <dt>Campanha</dt>
                <dd>{ad.campaign_name || "—"}</dd>
                <dt>Conjunto</dt>
                <dd>{ad.adset_name || "—"}</dd>
                <dt>Anúncio</dt>
                <dd>
                  {ad.ad_name || "—"} {ad.ad_status && <span className="badge badge-muted">{ad.ad_status}</span>}
                </dd>
                <dt>Gasto Total</dt>
                <dd>{formatMoney(ad.spend, client?.default_currency)}</dd>
                <dt>Impressões</dt>
                <dd>{formatNumber(ad.impressions)}</dd>
                <dt>Cliques</dt>
                <dd>{formatNumber(ad.clicks)}</dd>
                <dt>Conversas Iniciadas</dt>
                <dd>{formatNumber(ad.conversations)}</dd>
                <dt>Atualizado Em</dt>
                <dd className="muted small">{formatDateTime(ad.fetched_at)}</dd>
              </dl>
            ) : (
              <p className="muted small">
                Com o ID de origem, o painel busca no Meta o nome da campanha, do conjunto e do anúncio, a miniatura e o
                gasto.
              </p>
            )}
            {lead.source_id ? (
              <RefreshAdButton leadId={lead.id} hasData={!!ad} />
            ) : (
              <p className="muted small">Este lead não tem ID de origem.</p>
            )}
          </div>
        </div>

        <div>
          <div className="card">
            <h2>Enviar Evento ao Meta</h2>
            <SendEventForm leadId={lead.id} defaultCurrency={client?.default_currency || "BRL"} products={products} />
          </div>
        </div>
      </div>

      <div className="card table-wrap">
        <h2>Histórico de Envios Deste Lead</h2>
        {events.length === 0 ? (
          <p className="muted">Nenhum evento enviado ainda.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Enviado Em</th>
                <th>Evento</th>
                <th>Valor</th>
                <th>Resultado</th>
                <th>Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id}>
                  <td className="small">{formatDateTime(ev.created_at)}</td>
                  <td>
                    {eventLabel(ev.event_name)} {ev.is_test && <span className="badge badge-warn">Teste</span>}
                  </td>
                  <td>{formatMoney(ev.value, ev.currency || "BRL")}</td>
                  <td>
                    {ev.status === "enviado" ? (
                      <span className="badge badge-ok">Recebido Pelo Meta</span>
                    ) : (
                      <>
                        <span className="badge badge-err">Erro</span>
                        <div className="small" style={{ marginTop: 4 }}>{ev.error_message}</div>
                        <form action={resendEventAction} style={{ marginTop: 6 }}>
                          <input type="hidden" name="event_id" value={ev.id} />
                          <button className="btn btn-small">Reenviar</button>
                        </form>
                      </>
                    )}
                  </td>
                  <td>
                    <details>
                      <summary>Ver o Que Foi Enviado</summary>
                      <pre className="payload">{JSON.stringify(ev.payload, null, 2)}</pre>
                      <p className="small muted">Resposta do Meta:</p>
                      <pre className="payload">{JSON.stringify(ev.response, null, 2)}</pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <details>
          <summary>Editar Dados do Lead</summary>
          <div style={{ marginTop: 14 }}>
            <LeadForm clients={clientsData} lead={lead} />
          </div>
        </details>
      </div>

      <div className="card">
        <details>
          <summary>Dados Brutos Recebidos e Exclusão</summary>
          <pre className="payload" style={{ marginTop: 12 }}>{JSON.stringify(lead.raw ?? null, null, 2)}</pre>
          <form action={deleteLeadAction}>
            <input type="hidden" name="id" value={lead.id} />
            <button className="btn btn-danger btn-small">Excluir Este Lead e Seu Histórico</button>
          </form>
        </details>
      </div>
    </>
  );
}
