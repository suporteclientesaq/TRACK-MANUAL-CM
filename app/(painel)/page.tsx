import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowUpRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Info,
  MessageCircle,
  Plus,
  Search,
  ShieldCheck,
  Upload,
  UsersRound,
  Zap,
} from "lucide-react";
import { formatDateTime, formatMoney, formatPhone } from "@/lib/format";
import { listClients, listLeads, sentForLeads, adsFor } from "@/lib/store";
import { ClientSelectorForTxt } from "@/components/ClientSelectorForTxt";
import { SyncMetaButton } from "@/components/SyncMetaButton";
import { DeleteLeadButton } from "./leads/DeleteLeadButton";
import styles from "./Leads.module.css";
const PAGE_SIZE = 50;
type SearchParams = {
  cliente?: string;
  q?: string;
  filtro?: string;
  pagina?: string;
};
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Math.floor(Number(sp.pagina) || 1));
  const filtro = sp.filtro || "todos";
  const [clients, rows] = await Promise.all([
    listClients(),
    listLeads({
      clientId: sp.cliente || null,
      filter: filtro,
      q: sp.q,
      offset: (page - 1) * PAGE_SIZE,
      limit: PAGE_SIZE + 1,
    }),
  ]);
  const leads = rows.slice(0, PAGE_SIZE);
  const hasNext = rows.length > PAGE_SIZE;
  const [sentByLead, adByKey] = await Promise.all([
    sentForLeads(leads.map((lead) => lead.id)),
    adsFor(
      leads
        .filter((lead) => lead.source_id)
        .map((lead) => ({ clientId: lead.client_id, adId: lead.source_id! })),
    ),
  ]);
  const names = new Map(clients.map((client) => [client.id, client.name]));
  const pageLink = (next: number) => {
    const params = new URLSearchParams();
    if (sp.cliente) params.set("cliente", sp.cliente);
    if (sp.q) params.set("q", sp.q);
    if (sp.filtro) params.set("filtro", sp.filtro);
    if (next > 1) params.set("pagina", String(next));
    return "/" + (params.size ? "?" + params : "");
  };
  const exportParams = new URLSearchParams();
  if (sp.cliente) exportParams.set("cliente", sp.cliente);
  if (sp.q) exportParams.set("q", sp.q);
  if (sp.filtro) exportParams.set("filtro", sp.filtro);
  const bought = (id: string) =>
    (sentByLead.get(id) || []).filter(
      (event) =>
        event.event_name === "Purchase" &&
        !event.is_test &&
        event.status === "enviado",
    );
  const withClick = leads.filter(
    (lead) => lead.ctwa_clid && !lead.ctwa_clid.startsWith("ctwa_ad_"),
  ).length;
  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>RELACIONAMENTO</span>
          <h1>Seus contatos, mais próximos.</h1>
          <p>
            Reúna o contexto de cada pessoa e transforme boas conversas em
            oportunidades.
          </p>
        </div>
        <div className={styles.actions}>
          <a
            className={styles.secondary}
            href={"/api/leads/export?" + exportParams}
          >
            <ArrowDownToLine size={15} />
            Exportar contatos
          </a>
          <Link href="/leads/importar" className={styles.secondary}>
            <Upload size={15} />
            Importar
          </Link>
          <Link href="/leads/novo" className={styles.primary}>
            <Plus size={16} />
            Novo contato
          </Link>
        </div>
      </div>
      <div className={styles.stats}>
        <span>
          <UsersRound />
          <strong>{leads.length}</strong>contatos nesta página
        </span>
        <span>
          <ShieldCheck />
          <strong>{withClick}</strong>com clique CTWA
        </span>
        <span>
          <CheckCircle2 />
          <strong>
            {leads.filter((lead) => bought(lead.id).length > 0).length}
          </strong>
          com compra registrada
        </span>
      </div>
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2>
            Base de contatos
            <span>
              {sp.q
                ? "Busca ativa"
                : filtro !== "todos"
                  ? "Filtro ativo"
                  : "Todos"}
            </span>
          </h2>
          <span>
            <Clock3 size={12} />
            Mais recentes primeiro
          </span>
        </div>
        <form className={styles.filters} method="get">
          <label className={styles.search}>
            <Search size={15} />
            <input
              name="q"
              aria-label="Buscar contatos"
              placeholder="Buscar nome, telefone ou anúncio…"
              defaultValue={sp.q || ""}
            />
          </label>
          <select
            name="cliente"
            aria-label="Cliente"
            defaultValue={sp.cliente || ""}
          >
            <option value="">Todos os clientes</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
          <select
            name="filtro"
            aria-label="Filtrar contatos"
            defaultValue={filtro}
          >
            <option value="todos">Todos os contatos</option>
            <option value="com-ctwa">Com clique CTWA</option>
            <option value="sem-ctwa">Sem clique CTWA</option>
            <option value="com-venda">Com compra registrada</option>
            <option value="sem-venda">Sem compra registrada</option>
          </select>
          <button type="submit">Filtrar</button>
        </form>
        <div className={styles.tableScroll}>
          {leads.length === 0 ? (
            <div className={styles.empty}>
              <span>
                <UsersRound size={26} />
              </span>
              <h2>
                {clients.length
                  ? "Sua próxima conversa começa aqui"
                  : "Bem-vindo ao seu workspace"}
              </h2>
              <p>
                {clients.length
                  ? "Nenhum contato corresponde aos filtros. Importe seus contatos ou comece um novo cadastro."
                  : "Cadastre sua primeira empresa para conectar os canais e organizar seus contatos."}
              </p>
              <Link
                className={styles.primary}
                href={clients.length ? "/leads/novo" : "/clientes/novo"}
              >
                <Plus size={15} />
                {clients.length ? "Adicionar contato" : "Cadastrar cliente"}
              </Link>
            </div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Contato</th>
                  <th>Origem</th>
                  <th>Rastreio</th>
                  <th>Relacionamento</th>
                  <th>Primeiro contato</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead, index) => {
                  const name = lead.name || formatPhone(lead.phone);
                  const purchases = bought(lead.id);
                  const ad = lead.source_id
                    ? adByKey.get(lead.client_id + ":" + lead.source_id)
                    : null;
                  const click =
                    !!lead.ctwa_clid && !lead.ctwa_clid.startsWith("ctwa_ad_");
                  return (
                    <tr key={lead.id}>
                      <td>
                        <div className={styles.contact}>
                          <span
                            className={styles.avatar}
                            data-color={index % 4}
                          >
                            {name
                              .split(/\s+/)
                              .slice(0, 2)
                              .map((part) => part[0])
                              .join("")}
                          </span>
                          <div>
                            <Link href={"/leads/" + lead.id}>{name}</Link>
                            <small>
                              {formatPhone(lead.phone)} ·{" "}
                              {names.get(lead.client_id)}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className={styles.source}>
                          <strong>
                            {ad?.ad_name ||
                              lead.headline ||
                              (lead.source_id
                                ? "Anúncio identificado"
                                : "Conversa sem anúncio")}
                          </strong>
                          <span>
                            {ad?.campaign_name ||
                              (lead.source_id
                                ? "ID " + lead.source_id
                                : "Origem orgânica ou não informada")}
                          </span>
                        </div>
                      </td>
                      <td>
                        {click ? (
                          <span className={styles.tag}>
                            <ShieldCheck size={11} />
                            CTWA recebido
                          </span>
                        ) : lead.source_id ? (
                          <span className={styles.grayTag}>
                            Anúncio sem clique
                          </span>
                        ) : (
                          <span className={styles.grayTag}>
                            Sem identificação
                          </span>
                        )}
                      </td>
                      <td>
                        {purchases.length ? (
                          <div className={styles.purchase}>
                            <strong>
                              {formatMoney(
                                purchases.reduce(
                                  (sum, event) => sum + (event.value || 0),
                                  0,
                                ),
                                purchases[0].currency || "BRL",
                              )}
                            </strong>
                            <span>
                              {purchases.length} compra(s) em produção
                            </span>
                          </div>
                        ) : (
                          <span className={styles.muted}>
                            Em relacionamento
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={styles.muted}>
                          {formatDateTime(lead.first_seen_at)}
                        </span>
                      </td>
                      <td>
                        <div className={styles.rowActions}>
                          <Link href={"/conversas?lead=" + lead.id}>
                            <MessageCircle size={13} />
                            Conversar
                          </Link>
                          <Link
                            href={"/leads/" + lead.id}
                            aria-label={"Abrir cadastro de " + name}
                          >
                            <ArrowUpRight size={13} />
                          </Link>
                          <DeleteLeadButton
                            id={lead.id}
                            name={name}
                            back={pageLink(page)}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className={styles.pagination}>
          <span>
            A exportação inclui todos os contatos dos filtros selecionados.
          </span>
          <div>
            {page > 1 && (
              <Link href={pageLink(page - 1)} aria-label="Página anterior">
                <ChevronLeft size={14} />
              </Link>
            )}
            <span>Página {page}</span>
            {hasNext && (
              <Link href={pageLink(page + 1)} aria-label="Próxima página">
                <ChevronRight size={14} />
              </Link>
            )}
          </div>
        </div>
      </section>
      <div className={styles.tools}>
        <details className={styles.tool}>
          <summary>
            <FileText size={16} />
            Importar uma proposta<span>Arquivo .txt</span>
          </summary>
          <div>
            <ClientSelectorForTxt
              clients={clients.map(({ id, name }) => ({ id, name }))}
              defaultClientId={sp.cliente || clients[0]?.id || ""}
            />
          </div>
        </details>
        <details className={styles.tool}>
          <summary>
            <Zap size={16} />
            Sincronizar anúncios<span>Meta Ads</span>
          </summary>
          <div>
            <p>
              Atualize campanha, criativo e informações dos anúncios. O gasto do
              cache pode abranger todo o histórico da conta.
            </p>
            <SyncMetaButton clientId={sp.cliente || null} />
          </div>
        </details>
      </div>
      <p className={styles.bottomNote}>
        <Info size={12} />
        Identificar um anúncio não garante atribuição de venda. Confira o token
        de clique e a resposta do evento no histórico.
      </p>
    </div>
  );
}
