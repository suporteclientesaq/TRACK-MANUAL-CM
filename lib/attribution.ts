/**
 * Motor de Atribuição Last-Click — Track Manual
 *
 * Problema: quando um lead interage com múltiplos anúncios de campanhas diferentes,
 * a venda pode aparecer duplicada em todas as campanhas no dashboard.
 *
 * Solução: atribuição por ÚLTIMO CLIQUE (last-click attribution).
 * - O `ctwa_clid` registrado mais recentemente (`clid_seen_at`) define qual anúncio
 *   recebe o crédito da venda.
 * - Se o lead não tem `clid_seen_at`, usa `first_seen_at` como fallback.
 * - O `source_id` do lead NÃO é mais a única fonte de verdade — o clique mais
 *   recente ganha o crédito.
 *
 * Isso garante que uma venda é contada apenas UMA VEZ, na campanha certa.
 */

import type { EventRow, Lead } from "./types";

/** Resultado da atribuição de um evento a um anúncio/campanha específico. */
export interface AttributionResult {
  /** ID do anúncio que recebe o crédito (source_id do clique ganho). */
  winningAdId: string | null;

  /**
   * Modelo usado:
   * - "ctwa_last_click" → atribuído pelo ctwa_clid mais recente (mais confiável)
   * - "source_id_only"  → sem ctwa_clid, usou o source_id do lead diretamente
   * - "unattributed"    → lead sem nenhuma origem rastreável
   */
  model: "ctwa_last_click" | "source_id_only" | "unattributed";

  /** Data/hora do clique vencedor (ISO string). */
  clickedAt: string | null;

  /** Dias desde o clique vencedor (null se sem clique). */
  daysSinceClick: number | null;

  /**
   * true quando o source_id atual do lead difere do anúncio vencedor —
   * ou seja, o lead foi reaproveitado de uma campanha diferente da que originou a venda.
   */
  isDiverged: boolean;
}

/**
 * Dado um lead, determina qual anúncio recebe o crédito de uma conversão.
 * Usa o ctwa_clid mais recente (`clid_seen_at`) como critério primário.
 */
export function attributeLead(lead: Lead): AttributionResult {
  const now = Date.now();

  // Caso 1: lead tem ctwa_clid e clid_seen_at — atribuição mais confiável
  if (lead.ctwa_clid && lead.source_id) {
    const clickedAt = lead.clid_seen_at || lead.first_seen_at;
    const clickMs = new Date(clickedAt).getTime();
    const daysSinceClick = Math.floor((now - clickMs) / (1000 * 60 * 60 * 24));
    return {
      winningAdId: lead.source_id,
      model: "ctwa_last_click",
      clickedAt,
      daysSinceClick,
      isDiverged: false,
    };
  }

  // Caso 2: lead tem source_id mas sem ctwa_clid — atribuição por ID de origem
  if (lead.source_id) {
    const clickedAt = lead.first_seen_at;
    const clickMs = new Date(clickedAt).getTime();
    const daysSinceClick = Math.floor((now - clickMs) / (1000 * 60 * 60 * 24));
    return {
      winningAdId: lead.source_id,
      model: "source_id_only",
      clickedAt,
      daysSinceClick,
      isDiverged: false,
    };
  }

  // Caso 3: sem rastreamento — lead orgânico ou importado manualmente
  return {
    winningAdId: null,
    model: "unattributed",
    clickedAt: null,
    daysSinceClick: null,
    isDiverged: false,
  };
}

/**
 * Dado um conjunto de leads (todos com o mesmo telefone, de múltiplas campanhas),
 * determina qual deles ganha o crédito da conversão.
 *
 * Regras de desempate em ordem de prioridade:
 * 1. Lead com ctwa_clid e clid_seen_at mais recente
 * 2. Lead com ctwa_clid (sem clid_seen_at) e first_seen_at mais recente
 * 3. Lead com source_id e first_seen_at mais recente
 * 4. Qualquer lead mais recente
 */
export function resolveWinningLead(leads: Lead[]): Lead {
  if (leads.length === 1) return leads[0];

  // Separa por qualidade de rastreamento
  const withClidAndDate = leads.filter((l) => l.ctwa_clid && l.clid_seen_at);
  const withClidOnly = leads.filter((l) => l.ctwa_clid && !l.clid_seen_at);
  const withSourceId = leads.filter((l) => l.source_id && !l.ctwa_clid);

  const newest = (arr: Lead[], dateField: (l: Lead) => string): Lead =>
    arr.reduce((best, cur) =>
      new Date(dateField(cur)) > new Date(dateField(best)) ? cur : best
    );

  if (withClidAndDate.length > 0)
    return newest(withClidAndDate, (l) => l.clid_seen_at!);

  if (withClidOnly.length > 0)
    return newest(withClidOnly, (l) => l.first_seen_at);

  if (withSourceId.length > 0)
    return newest(withSourceId, (l) => l.first_seen_at);

  return newest(leads, (l) => l.first_seen_at);
}

/**
 * Constrói um mapa de lead_id → source_id vencedor.
 *
 * Para leads com o mesmo telefone, aplica `resolveWinningLead` e atribui o
 * crédito apenas ao lead vencedor. Os leads perdedores ficam sem source_id
 * efetivo no dashboard (evitando a duplicação).
 *
 * @param leads - todos os leads do período
 * @param clientId - filtra por cliente (opcional)
 */
export function buildAttributionMap(
  leads: Lead[],
  clientId?: string | null
): Map<string, string | null> {
  // Agrupa leads pelo telefone normalizado
  const byPhone = new Map<string, Lead[]>();
  for (const lead of leads) {
    if (clientId && lead.client_id !== clientId) continue;
    const key = `${lead.client_id}::${lead.phone}`;
    if (!byPhone.has(key)) byPhone.set(key, []);
    byPhone.get(key)!.push(lead);
  }

  // Para cada grupo, determina o vencedor e mapeia lead_id → winningAdId
  const map = new Map<string, string | null>();

  for (const group of byPhone.values()) {
    if (group.length === 1) {
      const attr = attributeLead(group[0]);
      map.set(group[0].id, attr.winningAdId);
      continue;
    }

    // Múltiplos leads com o mesmo telefone → resolve quem ganha o crédito
    const winner = resolveWinningLead(group);
    const winnerAttr = attributeLead(winner);

    for (const lead of group) {
      if (lead.id === winner.id) {
        // Líder: recebe o crédito do anúncio do clique vencedor
        map.set(lead.id, winnerAttr.winningAdId);
      } else {
        // Duplicata: não recebe crédito de conversão (evita dupla contagem)
        map.set(lead.id, null);
      }
    }
  }

  return map;
}

/**
 * Verifica se um lead específico é o vencedor dentro do seu grupo de telefone.
 * Útil para mostrar avisos na tela de detalhe do lead.
 */
export function checkLeadAttribution(
  lead: Lead,
  allLeadsForPhone: Lead[]
): {
  isWinner: boolean;
  winner: Lead;
  duplicateCount: number;
  attribution: AttributionResult;
} {
  const winner = resolveWinningLead(allLeadsForPhone);
  const attribution = attributeLead(winner);
  const isDiverged = winner.id !== lead.id && !!lead.source_id && lead.source_id !== winner.source_id;

  return {
    isWinner: winner.id === lead.id,
    winner,
    duplicateCount: allLeadsForPhone.length - 1,
    attribution: { ...attribution, isDiverged },
  };
}
