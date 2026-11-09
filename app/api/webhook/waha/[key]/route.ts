import { NextResponse, type NextRequest } from "next/server";
import { ingestLead } from "@/lib/ingest";
import { parseWahaWebhook } from "@/lib/waha";
import { getClientByWebhookKey, setupProblem } from "@/lib/store";

export const dynamic = "force-dynamic";

const MAX_BODY = 100_000;

/**
 * Endpoint de Webhook para WAHA (WhatsApp HTTP API - devlikeapro/waha).
 * Cadastre este endereço no WAHA no evento 'message':
 * http://seu-ip:3000/api/webhook/waha/[chave_do_cliente]
 *
 * Ao receber a mensagem Click-to-WhatsApp:
 * 1. Extrai o telefone do lead e nome
 * 2. Extrai ctwa_clid (ID de clique no anúncio)
 * 3. Extrai o anúncio (source_id, criativo, ou tag [AD:...])
 * 4. Salva e enriquece os dados automaticamente
 */
async function handle(req: NextRequest, key: string) {
  const problem = await setupProblem();
  if (problem)
    return NextResponse.json(
      { ok: false, error: problem.message },
      { status: 503 },
    );

  if (!/^[a-f0-9]{32,64}$/i.test(key)) {
    return NextResponse.json(
      { ok: false, error: "Chave inválida." },
      { status: 404 },
    );
  }

  const client = await getClientByWebhookKey(key);
  if (!client) {
    return NextResponse.json(
      { ok: false, error: "Cliente não encontrado para esta chave." },
      { status: 404 },
    );
  }

  if (req.method !== "POST") {
    return NextResponse.json({
      ok: true,
      message: "Webhook WAHA ativo. Envie requisições via POST.",
    });
  }

  let body: Record<string, unknown>;
  try {
    const rawText = await req.text();
    if (rawText.length > MAX_BODY) {
      return NextResponse.json(
        { ok: false, error: "Corpo da requisição grande demais." },
        { status: 413 },
      );
    }
    body = JSON.parse(rawText);
  } catch {
    return NextResponse.json(
      { ok: false, error: "JSON inválido no corpo da requisição." },
      { status: 400 },
    );
  }

  const parsed = parseWahaWebhook(body);

  if (!parsed.ok) {
    if (parsed.ignored) {
      return NextResponse.json({
        ok: true,
        ignored: true,
        reason: parsed.error,
      });
    }
    return NextResponse.json(
      { ok: false, error: parsed.error },
      { status: 400 },
    );
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
      notes: parsed.lead.message_text
        ? `WAHA: "${parsed.lead.message_text}"`
        : null,
    },
    "manual",
    {
      origin: "waha",
      received_at: parsed.lead.received_at || new Date().toISOString(),
      message_id: parsed.lead.message_id,
      fromMe: parsed.lead.fromMe,
      provider: "waha",
      type: parsed.lead.type,
      mimetype: parsed.lead.mimetype,
      media_url: parsed.lead.message_media_url,
      base64: parsed.lead.base64,
      filename: parsed.lead.filename,
      instance: parsed.lead.instance,
      message_text: parsed.lead.message_text,
    },
  );

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    lead_id: result.leadId,
    created: result.created,
    has_ctwa: Boolean(parsed.lead.ctwa_clid),
    source_id: parsed.lead.source_id,
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ key: string }> },
) {
  return handle(req, (await ctx.params).key);
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ key: string }> },
) {
  return handle(req, (await ctx.params).key);
}
