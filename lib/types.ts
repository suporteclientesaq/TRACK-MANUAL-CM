export type IdMode = "page" | "waba";

/** Estado devolvido pelas ações de formulário. */
export interface FormState {
  error: string | null;
}

export interface Client {
  id: string;
  name: string;
  webhook_key: string;
  pixel_id: string | null;
  capi_token_enc: string | null;
  page_id: string | null;
  waba_id: string | null;
  id_mode: IdMode;
  ad_account_id: string | null;
  marketing_token_enc: string | null;
  test_event_code: string | null;
  default_currency: string;
  send_extra_data: boolean;
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  client_id: string;
  name: string | null;
  phone: string;
  email: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string;
  ctwa_clid: string | null;
  source_id: string | null;
  source_url: string | null;
  source_type: string | null;
  thumbnail_url: string | null;
  media_url: string | null;
  headline: string | null;
  ad_body: string | null;
  origin: "leona" | "manual";
  notes: string | null;
  raw: unknown;
  first_seen_at: string;
  clid_seen_at: string | null;
  updated_at: string;
}

export interface EventRow {
  id: string;
  client_id: string;
  lead_id: string;
  event_name: string;
  event_id: string;
  event_time: string;
  value: number | null;
  currency: string | null;
  content_name: string | null;
  action_source: string;
  is_test: boolean;
  status: "enviado" | "erro";
  http_status: number | null;
  events_received: number | null;
  fbtrace_id: string | null;
  error_message: string | null;
  payload: unknown;
  response: unknown;
  created_at: string;
}

export interface AdInfo {
  client_id: string;
  ad_id: string;
  ad_name: string | null;
  ad_status: string | null;
  adset_id: string | null;
  adset_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  creative_title: string | null;
  creative_body: string | null;
  thumbnail_url: string | null;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  conversations: number | null;
  raw: unknown;
  fetched_at: string;
}

/** Eventos aceitos pelo Meta para mensagens de empresa (business_messaging). */
export const MESSAGING_EVENTS = [
  { value: "Purchase", label: "Compra", needsValue: true },
  { value: "LeadSubmitted", label: "Lead", needsValue: false },
  { value: "QualifiedLead", label: "Lead Qualificado", needsValue: false },
  { value: "InitiateCheckout", label: "Início de Checkout", needsValue: false },
  { value: "AddToCart", label: "Adição ao Carrinho", needsValue: false },
  { value: "ViewContent", label: "Visualização de Conteúdo", needsValue: false },
  { value: "OrderCreated", label: "Pedido Criado", needsValue: false },
  { value: "OrderShipped", label: "Pedido Enviado", needsValue: false },
  { value: "OrderDelivered", label: "Pedido Entregue", needsValue: false },
  { value: "OrderCanceled", label: "Pedido Cancelado", needsValue: false },
  { value: "OrderReturned", label: "Pedido Devolvido", needsValue: false },
  { value: "CartAbandoned", label: "Carrinho Abandonado", needsValue: false },
  { value: "RatingProvided", label: "Avaliação Recebida", needsValue: false },
  { value: "ReviewProvided", label: "Comentário Recebido", needsValue: false },
] as const;

export type MessagingEventName = (typeof MESSAGING_EVENTS)[number]["value"];

export function eventLabel(name: string): string {
  return MESSAGING_EVENTS.find((e) => e.value === name)?.label ?? name;
}
