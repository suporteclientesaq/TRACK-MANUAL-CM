import { NextResponse, type NextRequest } from "next/server";
import { ingestLead } from "@/lib/ingest";
import { parseBody } from "@/lib/leona";
import { getClientByWebhookKey, setupProblem } from "@/lib/store";

export const dynamic = "force-dynamic";

const MAX_BODY = 50_000;

/**
 * Entrada automática de leads. A Leona chama este endereço pelo bloco de
 * Integração HTTP quando o painel tem um endereço público; a chave no final
 * identifica o cliente. Aceita POST (JSON ou formulário) e GET.
 */
async function handle(req: NextRequest, key: string) {
  const problem = await setupProblem();
  if (problem) return NextResponse.json({ ok: false, error: problem.message }, { status: 503 });
  if (!/^[a-f0-9]{32,64}$/i.test(key)) {
    return NextResponse.json({ ok: false, error: "Chave inválida." }, { status: 404 });
  }
  const client = await getClientByWebhookKey(key);
  if (!client) return NextResponse.json({ ok: false, error: "Chave inválida." }, { status: 404 });

  const fields: Record<string, unknown> = Object.fromEntries(req.nextUrl.searchParams);
  if (req.method === "POST") {
    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY) {
      return NextResponse.json({ ok: false, error: "Corpo grande demais." }, { status: 413 });
    }
    Object.assign(fields, parseBody(rawBody, req.headers.get("content-type")));
  }

  const result = await ingestLead(client.id, fields, "leona", {
    received_at: new Date().toISOString(),
    method: req.method,
    fields,
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, lead_id: result.leadId, created: result.created });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  return handle(req, (await ctx.params).key);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  return handle(req, (await ctx.params).key);
}
