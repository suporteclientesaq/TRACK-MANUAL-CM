import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
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

  return (
    <>
      <div className="page-head">
        <h1>{client ? client.name : "Cadastrar Cliente"}</h1>
        <Link className="btn" href="/clientes">
          Voltar aos Clientes
        </Link>
      </div>

      {salvo && <div className="note note-ok">Cliente salvo.</div>}

      <div className="card">
        <ClientForm client={client} />
      </div>

      {client && (
        <div className="card">
          <h2>Como os Leads Entram</h2>
          {isOnline() ? (
            <>
              <p>
                O painel está na internet, então a Leona pode mandar cada lead novo sozinha. No fluxo de boas-vindas,
                logo depois do início, adicione um bloco de <strong>Integração</strong> com método{" "}
                <strong>POST</strong>, cabeçalho <span className="mono">Content-Type: application/json</span>, o
                endereço e o corpo abaixo. Ligue as duas saídas do bloco (sucesso e falha) ao passo seguinte, para o
                lead nunca ficar parado.
              </p>
              <CopyBox label="Endereço (URL) — Trate Como Senha" value={webhookUrl} />
              <CopyBox label="Corpo (JSON)" value={LEONA_BODY} multiline />
              <div className="note note-warn">
                Confira os nomes das variáveis no seletor de variáveis da Leona ao montar o bloco. Os campos de anúncio
                aparecem lá como CTWA Click ID, Source ID, Source URL, Thumbnail URL e Media URL. Depois do primeiro
                lead, abra-o aqui e veja em “Dados Brutos Recebidos” exatamente o que chegou.
              </div>
              <p className="muted small">
                Para trazer os contatos antigos, use <Link href="/leads/importar">Importar</Link> com o CSV exportado da
                Leona.
              </p>
            </>
          ) : (
            <>
              <p>
                O caminho normal é <Link href="/leads/importar">Importar</Link>: exporte os contatos na Leona e traga o
                CSV. Quem já existe é atualizado pelo telefone, então pode repetir sempre que quiser.
              </p>
              <details>
                <summary>Entrada automática pela Leona (só funciona com o painel em um endereço público)</summary>
                <p className="muted small" style={{ marginTop: 10 }}>
                  Rodando só no seu computador, a Leona não alcança o painel. Se o painel estiver publicado (Netlify,
                  Vercel ou um túnel), adicione no fluxo de boas-vindas da Leona um bloco de{" "}
                  <strong>Integração</strong> com método <strong>POST</strong>, cabeçalho{" "}
                  <span className="mono">Content-Type: application/json</span>, o endereço e o corpo abaixo, trocando{" "}
                  <span className="mono">{host}</span> pelo endereço público.
                </p>
                <CopyBox label="Endereço (URL) — Trate Como Senha" value={webhookUrl} />
                <CopyBox label="Corpo (JSON)" value={LEONA_BODY} multiline />
              </details>
            </>
          )}
        </div>
      )}
    </>
  );
}
