"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDownUp,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  GitBranch,
  GripVertical,
  Info,
  Loader2,
  Megaphone,
  MessageCircle,
  Plus,
  Search,
  UsersRound,
} from "lucide-react";
import { PIPELINE_STAGES, type PipelineStage } from "@/lib/pipeline";
import { movePipelineLead } from "@/app/pipeline-actions";
import { formatMoney, formatPhone } from "@/lib/format";
import styles from "./Pipeline.module.css";
interface Card {
  id: string;
  name: string;
  phone: string;
  company: string;
  clientId: string;
  stage: PipelineStage;
  ad: boolean;
  notes: string | null;
  updatedAt: string;
  revenue: number;
  currency: string;
  hasPurchase: boolean;
}
export function PipelineBoard({
  initialCards,
  clients,
  clientId,
  hasMore,
}: {
  initialCards: Card[];
  clients: { id: string; name: string }[];
  clientId: string;
  hasMore: boolean;
}) {
  const router = useRouter();
  const [cards, setCards] = useState(initialCards);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [over, setOver] = useState<PipelineStage | null>(null);
  useEffect(() => {
    setCards(initialCards);
  }, [initialCards]);
  const filtered = useMemo(
    () =>
      cards.filter((card) =>
        (card.name + " " + card.phone + " " + card.company)
          .toLocaleLowerCase("pt-BR")
          .includes(query.toLocaleLowerCase("pt-BR")),
      ),
    [cards, query],
  );
  const move = async (id: string, stage: PipelineStage) => {
    if (busy) return;
    setBusy(id);
    setNotice(null);
    try {
      const result = await movePipelineLead(id, stage);
      if (result.ok)
        setCards((previous) =>
          previous.map((card) => (card.id === id ? { ...card, stage } : card)),
        );
      setNotice(result.message);
    } catch {
      setNotice("Não foi possível mover o contato. Tente novamente.");
    } finally {
      setBusy(null);
      setDragged(null);
      setOver(null);
    }
  };
  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>OPORTUNIDADES</span>
          <h1>Cada conversa, um próximo passo.</h1>
          <p>
            Visualize seu atendimento e acompanhe os contatos até a conclusão.
          </p>
        </div>
        <Link href="/leads/novo" className={styles.primary}>
          <Plus size={16} />
          Novo contato
        </Link>
      </div>
      <div className={styles.summary}>
        <div>
          <span className={styles.statIcon}>
            <UsersRound size={20} />
          </span>
          <div>
            <span>Contatos no funil</span>
            <strong>{cards.length}</strong>
          </div>
        </div>
        <div>
          <span className={styles.statIcon}>
            <MessageCircle size={20} />
          </span>
          <div>
            <span>Em acompanhamento</span>
            <strong>
              {cards.filter((card) => card.stage !== "won").length}
            </strong>
          </div>
        </div>
        <div>
          <span className={styles.greenIcon}>
            <CheckCircle2 size={20} />
          </span>
          <div>
            <span>Etapa concluída</span>
            <strong>
              {cards.filter((card) => card.stage === "won").length}
            </strong>
          </div>
        </div>
      </div>
      <div className={styles.toolbar}>
        <span>
          <GitBranch size={17} />
          <strong>Funil de relacionamento</strong>
          <span className={styles.tag}>4 etapas</span>
        </span>
        <div>
          <label className={styles.search}>
            <Search size={15} />
            <input
              placeholder="Buscar oportunidade…"
              aria-label="Buscar oportunidade"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className={styles.client}>
            <select
              aria-label="Filtrar funil por cliente"
              value={clientId}
              onChange={(event) =>
                router.push(
                  "/funil" +
                    (event.target.value
                      ? "?cliente=" + event.target.value
                      : ""),
                )
              }
            >
              <option value="">Todos os clientes</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </label>
        </div>
      </div>
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      {hasMore && (
        <p className={styles.notice}>
          Mostrando os 200 contatos mais recentes. Filtre por cliente para
          refinar seu funil.
        </p>
      )}
      <div className={styles.board}>
        {PIPELINE_STAGES.map((stage) => {
          const items = filtered.filter((card) => card.stage === stage.id);
          return (
            <section
              key={stage.id}
              className={styles.column}
              data-over={over === stage.id}
              onDragOver={(event) => {
                event.preventDefault();
                setOver(stage.id);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(event) => {
                event.preventDefault();
                if (dragged) void move(dragged, stage.id);
              }}
            >
              <header>
                <div>
                  <span style={{ background: stage.color }} />
                  <h2>{stage.title}</h2>
                  <strong>{items.length}</strong>
                </div>
                <p>{stage.description}</p>
              </header>
              <div className={styles.cards}>
                {items.map((card) => (
                  <article
                    key={card.id}
                    className={styles.card}
                    draggable={!busy}
                    onDragStart={() => setDragged(card.id)}
                    onDragEnd={() => {
                      setDragged(null);
                      setOver(null);
                    }}
                    data-pending={busy === card.id}
                  >
                    <div className={styles.cardTop}>
                      <span className={styles.avatar}>
                        {card.name
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((part) => part[0])
                          .join("")}
                      </span>
                      <span>
                        <Link href={"/leads/" + card.id}>{card.name}</Link>
                        <small>{formatPhone(card.phone)}</small>
                      </span>
                      <GripVertical size={15} />
                    </div>
                    <div className={styles.cardTags}>
                      <span>{card.company}</span>
                      {card.ad && (
                        <span>
                          <Megaphone size={10} />
                          Anúncio
                        </span>
                      )}
                    </div>
                    <p className={styles.cardNote}>
                      {card.notes ||
                        "Abra a conversa e registre o próximo passo deste atendimento."}
                    </p>
                    <div className={styles.cardValue}>
                      {card.hasPurchase ? (
                        <>
                          <CheckCircle2 size={12} />
                          {formatMoney(card.revenue, card.currency)}
                          <span>em compras</span>
                        </>
                      ) : (
                        <span>Sem compra registrada</span>
                      )}
                    </div>
                    <div className={styles.cardBottom}>
                      <Link href={"/conversas?lead=" + card.id}>
                        <MessageCircle size={13} />
                        Conversar
                        <ArrowUpRight size={12} />
                      </Link>
                      <label>
                        {busy === card.id ? (
                          <Loader2 size={13} className={styles.spin} />
                        ) : (
                          <ArrowDownUp size={13} />
                        )}
                        <select
                          aria-label={
                            "Mover " + card.name + " para outra etapa"
                          }
                          value={card.stage}
                          disabled={!!busy}
                          onChange={(event) =>
                            void move(
                              card.id,
                              event.target.value as PipelineStage,
                            )
                          }
                        >
                          {PIPELINE_STAGES.map((item) => (
                            <option value={item.id} key={item.id}>
                              {item.title}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </article>
                ))}
                {items.length === 0 && (
                  <div className={styles.empty}>
                    <GitBranch size={23} />
                    <strong>Espaço para uma oportunidade</strong>
                    <p>
                      Arraste um contato para esta etapa ou use o seletor no
                      cartão.
                    </p>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
      <div className={styles.note}>
        <Info size={14} />
        <p>
          Mover um contato organiza o atendimento. Para registrar uma compra e
          enviar à Meta, abra a conversa e use <strong>Registrar venda</strong>.
        </p>
      </div>
    </div>
  );
}
