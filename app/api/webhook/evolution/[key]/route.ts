import { NextResponse, type NextRequest } from "next/server";
import { ingestLead } from "@/lib/ingest";
import { parseEvolutionWebhook } from "@/lib/evolution";
import { getClientByWebhookKey, setupProblem } from "@/lib/store";

export const dynamic = "force-dynamic";

const MAX_BODY = 100_000;

/**
 * Endpoint de Webhook para Evolution API (v1 e v2).
 * Cadastre este endereço no painel da Evolution API no evento MESSAGES_UPSERT:
 * http://seu-ip:3000/api/webhook/evolution/[chave_do_cliente]
 *
 * Ao receber uma nova mensagem de lead Click-to-WhatsApp:
 * 1. Extrai o telefone e nome do contato
 * 2. Extrai o ctwa_clid (ID do clique no anúncio)
 * 3. Extrai o ID do anúncio, miniatura, texto e link
 * 4. Salva ou atualiza o lead automaticamente no painel
 */
async function handle(req: NextRequest, key: string) {
  const problem = await setupProblem();
  if (problem) return NextResponse.json({ ok: false, error: problem.message }, { status: 503 });

  if (!/^[a-f0-9]{32,64}$/i.test(key)) {
    return NextResponse.json({ ok: false, error: "Chave inválida." }, { status: 404 });
  }

  const client = await getClientByWebhookKey(key);
  if (!client) {
    return NextResponse.json({ ok: false, error: "Cliente não encontrado para esta chave." }, { status: 404 });
  }

  if (req.method !== "POST") {
    return NextResponse.json({ ok: true, message: "Webhook Evolution API ativo. Envie requisições via POST." });
  }

  let body: Record<string, unknown>;
  try {
    const rawText = await req.text();
    if (rawText.length > MAX_BODY) {
      return NextResponse.json({ ok: false, error: "Corpo da requisição grande demais." }, { status: 413 });
    }
    body = JSON.parse(rawText);
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido no corpo da requisição." }, { status: 400 });
  }

  const parsed = parseEvolutionWebhook(body);

  if (!parsed.ok) {
    // Mensagens de grupo, status ou enviadas pelo próprio número (fromMe) são ignoradas com status 200
    if (parsed.ignored) {
      return NextResponse.json({ ok: true, ignored: true, reason: parsed.error });
    }
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const result = await ingestLead(
    client.id,
    {
      name: parsed.lead.name,
      phone: parsed.lead.phone,
      ctwa_clid: parsed.lead.ctwa_clid,
      source_id: parsed.lead.source_id,
      source_url: parsed.lead.source_url,
      thumbnail_url: parsed.lead.thumbnail_url,
      media_url: parsed.lead.media_url,
      headline: parsed.lead.headline,
      ad_body: parsed.lead.ad_body,
      notes: parsed.lead.message_text ? `Primeira msg: "${parsed.lead.message_text}"` : null,
    },
    "manual",
    {
      origin: "evolution-api",
      received_at: new Date().toISOString(),
      instance: parsed.lead.instance,
      message_text: parsed.lead.message_text,
    }
  );

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    lead_id: result.leadId,
    created: result.created,
    has_ctwa: Boolean(parsed.lead.ctwa_clid),
    source_id: parsed.lead.source_id,
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  return handle(req, (await ctx.params).key);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  return handle(req, (await ctx.params).key);
}
