import { NextResponse, type NextRequest } from "next/server";
import { ingestLead } from "@/lib/ingest";
import { parseBody } from "@/lib/leona";
import { getClientByWebhookKey, setupProblem } from "@/lib/store";

export const dynamic = "force-dynamic";
const MAX_BODY = 50_000;

/** Recebe contatos; valores/status de uma proposta não disparam conversões. */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ key: string }> },
) {
  const key = (await ctx.params).key;
  if (!/^[a-f0-9]{32,64}$/i.test(key)) {
    return NextResponse.json(
      { ok: false, error: "Chave inválida." },
      { status: 404 },
    );
  }
  const problem = await setupProblem();
  if (problem)
    return NextResponse.json(
      { ok: false, error: problem.message },
      { status: 503 },
    );
  const client = await getClientByWebhookKey(key);
  if (!client)
    return NextResponse.json(
      { ok: false, error: "Chave inválida." },
      { status: 404 },
    );
  const declaredLength = Number(req.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY)
    return NextResponse.json(
      { ok: false, error: "Corpo grande demais." },
      { status: 413 },
    );
  const reader = req.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) {
        await reader.cancel();
        return NextResponse.json(
          { ok: false, error: "Corpo grande demais." },
          { status: 413 },
        );
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const fields = {
    ...Object.fromEntries(req.nextUrl.searchParams),
    ...parseBody(
      new TextDecoder().decode(bytes),
      req.headers.get("content-type"),
    ),
  };
  const result = await ingestLead(client.id, fields, "leona", {
    received_at: new Date().toISOString(),
    method: "POST",
    fields,
  });
  if (!result.ok)
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 400 },
    );
  return NextResponse.json({
    ok: true,
    lead_id: result.leadId,
    created: result.created,
    auto_tracked: false,
    auto_track_message:
      "Contato recebido. Conversões são conferidas e enviadas pelo painel.",
  });
}

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "Use POST para receber contatos. Este endereço não altera dados por GET.",
    },
    { status: 405, headers: { Allow: "POST" } },
  );
}
