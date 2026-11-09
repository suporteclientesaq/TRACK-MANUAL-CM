import type { EventRow, Lead } from "./types";
export const PIPELINE_STAGES = [
  {
    id: "new",
    title: "Novos contatos",
    description: "A primeira conexão",
    color: "#9a8bb7",
  },
  {
    id: "contact",
    title: "Em atendimento",
    description: "Construindo relacionamento",
    color: "#8a59db",
  },
  {
    id: "proposal",
    title: "Proposta enviada",
    description: "Mais perto de uma decisão",
    color: "#d5a34e",
  },
  {
    id: "won",
    title: "Concluídos",
    description: "Relacionamentos que avançaram",
    color: "#41a88c",
  },
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number]["id"];
export function isPipelineStage(value: unknown): value is PipelineStage {
  return PIPELINE_STAGES.some((stage) => stage.id === value);
}
export function stageFor(lead: Lead, events: EventRow[]): PipelineStage {
  const raw =
    lead.raw && typeof lead.raw === "object"
      ? (lead.raw as Record<string, unknown>)
      : {};
  if (isPipelineStage(raw.pipeline_stage)) return raw.pipeline_stage;
  if (
    events.some(
      (event) =>
        event.event_name === "Purchase" &&
        !event.is_test &&
        event.status === "enviado",
    )
  )
    return "won";
  if (
    events.some(
      (event) =>
        event.event_name === "InitiateCheckout" &&
        !event.is_test &&
        event.status === "enviado",
    )
  )
    return "proposal";
  const messages = Array.isArray(raw.messages)
    ? (raw.messages as Record<string, unknown>[])
    : [];
  return messages.some((message) => message.fromMe === true)
    ? "contact"
    : "new";
}
