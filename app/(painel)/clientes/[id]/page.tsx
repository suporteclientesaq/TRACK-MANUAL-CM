import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getClient, isOnline } from "@/lib/store";
import type { Client } from "@/lib/types";
import { ClientForm } from "./ClientForm";
import { CopyBox } from "./CopyBox";

/** Corpo sugerido para o bloco de Integração HTTP da Leona. */
const LEONA_BODY = `{
  "name": "{first_name}",
  "phone": "{phone_number}",
  "ctwa_clid": "{ctwa_clid}",
  "source_id": "{source_id}",
  "source_url": "{source_url}",
  "thumbnail_url": "{thumbnail_url}",
  "media_url": "{media_url}"
}`;

export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ salvo?: string }>;
}) {
  const { id } = await params;
  const { salvo } = await searchParams;

  let client: Client | undefined;
  if (id !== "novo") {
    if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
    client = (await getClient(id)) ?? undefined;
    if (!client) notFound();
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  const proto = h.get("x-forwarded-proto") || "http";
  const webhookUrl = client ? `${proto}://${host}/api/webhook/leona/${client.webhook_key}` : "";
  const evolutionWebhookUrl = client ? `${proto}://${host}/api/webhook/evolution/${client.webhook_key}` : "";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{client ? client.name : "Cadastrar Cliente"}</h1>
          <p className="muted small">
            {client ? "Pixel, tokens, Página e a entrada dos leads deste cliente." : "Pixel, token da API de Conversões e ID da Página."}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/clientes">
            <ChevronLeft />
            Voltar aos Clientes
          </Link>
        </Button>
      </div>

      {salvo && <div className="note note-ok">Cliente salvo.</div>}

      <div className="card">
        <ClientForm client={client} />
      </div>

      {client && (
        <div className="card">
          <h2>Como os Leads Entram Automaticamente</h2>

          <div style={{ marginBottom: "20px" }}>
            <h3 style={{ fontSize: "15px", margin: "0 0 6px 0", color: "#34c77b" }}>
              Opção 1: Webhook Evolution API (WhatsApp Direto)
            </h3>
            <p className="muted small" style={{ margin: "0 0 10px 0" }}>
              Conecte sua instância da Evolution API (v1 ou v2). No painel da Evolution, configure este webhook ativando o evento <strong>MESSAGES_UPSERT</strong>. O Track Manual puxará automaticamente o telefone, nome, anúncio e o código <strong>ctwa_clid</strong> a cada nova conversa!
            </p>
            <CopyBox label="URL do Webhook Evolution API — Trate Como Senha" value={evolutionWebhookUrl} />
          </div>

          <div style={{ borderTop: "1px solid var(--border)", paddingTop: "16px" }}>
            <h3 style={{ fontSize: "15px", margin: "0 0 6px 0", color: "#b394ff" }}>
              Opção 2: Webhook Leona (Fluxo de Chatbot)
            </h3>
            <p className="muted small" style={{ margin: "0 0 10px 0" }}>
              Para receber contatos pelo fluxo da Leona, adicione um bloco de <strong>Integração HTTP (POST)</strong> com cabeçalho <span className="mono">Content-Type: application/json</span>.
            </p>
            <CopyBox label="URL do Webhook Leona" value={webhookUrl} />
            <CopyBox label="Corpo (JSON)" value={LEONA_BODY} multiline />
          </div>
        </div>
      )}
    </>
  );
}

