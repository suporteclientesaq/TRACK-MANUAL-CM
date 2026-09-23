-- Track Manual: cria as tabelas do painel. Pode rodar mais de uma vez.
create table if not exists clients (
  id                  text primary key,
  name                text not null,
  webhook_key         text not null unique,
  pixel_id            text,
  capi_token_enc      text,
  page_id             text,
  waba_id             text,
  id_mode             text not null default 'page',
  ad_account_id       text,
  marketing_token_enc text,
  test_event_code     text,
  default_currency    text not null default 'BRL',
  send_extra_data     boolean not null default true,
  created_at          text not null,
  updated_at          text not null
);

create table if not exists leads (
  id             text primary key,
  client_id      text not null references clients(id) on delete cascade,
  name           text,
  phone          text not null,
  email          text,
  city           text,
  state          text,
  zip            text,
  country        text not null default 'br',
  ctwa_clid      text,
  source_id      text,
  source_url     text,
  source_type    text,
  thumbnail_url  text,
  media_url      text,
  headline       text,
  ad_body        text,
  origin         text not null default 'manual',
  notes          text,
  raw            jsonb,
  first_seen_at  text not null,
  clid_seen_at   text,
  updated_at     text not null,
  unique (client_id, phone)
);
create index if not exists leads_client_seen_idx on leads (client_id, first_seen_at desc);
create index if not exists leads_source_idx on leads (source_id);

create table if not exists events (
  id              text primary key,
  client_id       text not null references clients(id) on delete cascade,
  lead_id         text not null references leads(id) on delete cascade,
  event_name      text not null,
  event_id        text not null,
  event_time      text not null,
  value           numeric(12,2),
  currency        text,
  content_name    text,
  action_source   text not null,
  is_test         boolean not null default false,
  status          text not null,
  http_status     integer,
  events_received integer,
  fbtrace_id      text,
  error_message   text,
  payload         jsonb not null,
  response        jsonb,
  created_at      text not null
);
create index if not exists events_lead_idx on events (lead_id, created_at desc);
create index if not exists events_client_idx on events (client_id, created_at desc);

create table if not exists ad_cache (
  client_id      text not null references clients(id) on delete cascade,
  ad_id          text not null,
  ad_name        text,
  ad_status      text,
  adset_id       text,
  adset_name     text,
  campaign_id    text,
  campaign_name  text,
  creative_title text,
  creative_body  text,
  thumbnail_url  text,
  spend          numeric(12,2),
  impressions    bigint,
  clicks         bigint,
  conversations  bigint,
  raw            jsonb,
  fetched_at     text not null,
  primary key (client_id, ad_id)
);

create table if not exists settings (
  key   text primary key,
  value text not null
);

-- No Supabase toda tabela fica exposta pela API; com RLS ligada e sem políticas,
-- só a chave de serviço (a que o painel usa) consegue ler e gravar.
alter table clients  enable row level security;
alter table leads    enable row level security;
alter table events   enable row level security;
alter table ad_cache enable row level security;
alter table settings enable row level security;

notify pgrst, 'reload schema';
