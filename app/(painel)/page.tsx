import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus, Search, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LivePoller } from "@/components/LivePoller";
import { formatDateTime, formatMoney, formatPhone } from "@/lib/format";
import { DeleteLeadButton } from "./leads/DeleteLeadButton";
import { ClientSelectorForTxt } from "@/components/ClientSelectorForTxt";
import { QuickSaleButton } from "@/components/QuickSaleButton";
import { SyncMetaButton } from "@/components/SyncMetaButton";
import { ExportLeadsButton } from "@/components/ExportLeadsButton";
import { adsFor, listClients, listLeads, sentForLeads } from "@/lib/store";
import { eventLabel } from "@/lib/types";

const PAGE_SIZE = 50;

type Search = { cliente?: string; q?: string; filtro?: string; pagina?: string };

function getDisplayName(lead: any): string {
  if (lead.name && lead.name.trim() && lead.name.trim() !== "Sem Nome") {
    return lead.name.trim();
  }
  const raw = lead.raw as Record<string, any> | null;
  if (raw) {
    if (typeof raw.pushName === "string" && raw.pushName.trim()) return raw.pushName.trim();
    if (typeof raw.pushname === "string" && raw.pushname.trim()) return raw.pushname.trim();
    if (typeof raw.notifyName === "string" && raw.notifyName.trim()) return raw.notifyName.trim();
    if (typeof raw.verifiedName === "string" && raw.verifiedName.trim()) return raw.verifiedName.trim();
    if (typeof raw.name === "string" && raw.name.trim() && raw.name.trim() !== "Sem Nome") return raw.name.trim();
    if (raw.sender && typeof raw.sender.name === "string" && raw.sender.name.trim()) return raw.sender.name.trim();
  }
  return formatPhone(lead.phone);
}

function getAvatarOrThumb(lead: any): string | null {
  if (lead.thumbnail_url) return lead.thumbnail_url;
  const raw = lead.raw as Record<string, any> | null;
  if (raw && typeof raw.profilePicUrl === "string" && raw.profilePicUrl.startsWith("http")) {
    return raw.profilePicUrl;
  }
  return null;
}

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
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <h1 style={{ margin: 0 }}>Leads</h1>
            <LivePoller intervalMs={6000} label="AO VIVO • TEMPO REAL" />
          </div>
          <p className="muted small">Abra um lead para conferir os dados e enviar o evento ao Meta.</p>
        </div>
        <div className="actions" style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <ExportLeadsButton
            leads={leads.map((l) => ({
              name: getDisplayName(l),
              phone: l.phone,
              city: l.city,
              state: l.state,
              ctwa_clid: l.ctwa_clid,
              source_id: l.source_id,
              headline: l.headline,
              first_seen_at: l.first_seen_at,
              clientName: clientName.get(l.client_id),
              hasPurchase: (sentByLead.get(l.id) || []).some((e) => e.event_name === "Purchase"),
            }))}
          />
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
          <option value="com-ctwa">✅ Com ctwa_clid</option>
          <option value="sem-ctwa">⚠️ Sem ctwa_clid</option>
          <option value="com-venda">💰 Com Venda Enviada</option>
          <option value="sem-venda">📭 Sem Venda Enviada</option>
        </select>
        <Button variant="secondary" type="submit">
          <Search />
          Filtrar
        </Button>
      </form>

      {/* ─── Importar Proposta .TXT + Sincronizar Meta ───────────────────── */}
      <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start" }}>
        {/* Drop zone de proposta */}
        <div style={{ flex: "1 1 320px", minWidth: 280 }}>
          <p style={{ margin: "0 0 8px", fontWeight: 600, fontSize: 14 }}>📄 Importar Proposta (.txt)</p>
          <ClientSelectorForTxt
            clients={clients.map((c) => ({ id: c.id, name: c.name }))}
            defaultClientId={sp.cliente || clients[0]?.id || ""}
          />
        </div>

        {/* Sincronizar dados do Meta */}
        <div style={{ flex: "1 1 260px", minWidth: 220 }}>
          <p style={{ margin: "0 0 8px", fontWeight: 600, fontSize: 14 }}>📊 Dados do Meta</p>
          <p className="muted small" style={{ margin: "0 0 10px" }}>
            Atualiza campanha, conjunto, criativo, gasto, impressões, cliques e conversas de todos os anúncios.
          </p>
          <SyncMetaButton clientId={sp.cliente || null} />
        </div>
      </div>

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
                <th></th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => {
                const ad = lead.source_id ? adByKey.get(`${lead.client_id}:${lead.source_id}`) : undefined;
                const sent = sentByLead.get(lead.id) || [];
                const displayName = getDisplayName(lead);
                const photoUrl = getAvatarOrThumb(lead);

                return (
                  <tr key={lead.id}>
                    <td>
                      {photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="thumb" src={photoUrl} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ borderRadius: "6px", objectFit: "cover" }} />
                      ) : (
                        <div className="thumb-empty" />
                      )}
                    </td>
                    <td>
                      <Link href={`/leads/${lead.id}`}>
                        <strong>{displayName}</strong>
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
                      {lead.ctwa_clid && !lead.ctwa_clid.startsWith("ctwa_ad_") ? (
                        <span className="badge badge-ok" title={`Token CTWA Meta: ${lead.ctwa_clid}`}>
                          🎯 CTWA ✓
                        </span>
                      ) : lead.source_id || (lead.ctwa_clid && lead.ctwa_clid.startsWith("ctwa_ad_")) ? (
                        <span
                          className="badge badge-ok"
                          style={{
                            background: "rgba(52, 199, 123, 0.15)",
                            color: "#34c77b",
                            border: "1px solid rgba(52, 199, 123, 0.4)",
                            fontWeight: 700,
                          }}
                          title={`Atribuído ao Anúncio #${lead.source_id || lead.ctwa_clid?.replace("ctwa_ad_", "")}`}
                        >
                          🎯 CTWA (AD) ✓
                        </span>
                      ) : lead.headline || lead.thumbnail_url ? (
                        <span
                          className="badge badge-ok"
                          style={{
                            background: "rgba(52, 199, 123, 0.15)",
                            color: "#34c77b",
                            border: "1px solid rgba(52, 199, 123, 0.4)",
                            fontWeight: 700,
                          }}
                          title="Lead com anúncio/criativo detectado nas mensagens"
                        >
                          🎯 CTWA (AD) ✓
                        </span>
                      ) : (
                        <span className="badge badge-muted" style={{ opacity: 0.75 }} title="Sem clique ou anúncio Meta capturado">
                          Não Rastreado
                        </span>
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
                    <td className="row-actions">
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <Button asChild size="sm" variant="outline" title="Ver Conversa e Detalhes" style={{ padding: "4px 8px", height: "28px" }}>
                          <Link href={`/conversas?lead=${lead.id}`}>
                            💬 Conversa
                          </Link>
                        </Button>
                        <QuickSaleButton
                          leadId={lead.id}
                          leadName={lead.name}
                          leadPhone={formatPhone(lead.phone)}
                          notes={lead.notes}
                        />
                        <DeleteLeadButton id={lead.id} name={lead.name || formatPhone(lead.phone)} back={pageLink(page)} />
                      </div>
                    </td>
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
