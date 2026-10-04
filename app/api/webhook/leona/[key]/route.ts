import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { appSecret } from "@/lib/config";
import { decrypt } from "@/lib/crypto";
import { metaApiVersion } from "@/lib/env";
import { ingestLead } from "@/lib/ingest";
import { parseBody } from "@/lib/leona";
import { buildEvent, sendEvent } from "@/lib/meta";
import { getClientByWebhookKey, getLead, insertEvent, setupProblem } from "@/lib/store";

export const dynamic = "force-dynamic";

const MAX_BODY = 50_000;

/**
 * Entrada automática de leads e conversões.
 * A Leona chama este endereço pelo bloco de Integração HTTP; a chave no final
 * identifica o cliente.
 * Se o webhook enviar dados de venda/conversão (event_name, valor, status="won"),
 * o painel envia automaticamente a conversão ao Meta de ponta a ponta sem burocracia.
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

  // ---- Rastreamento Automático de Conversão (End-to-End) ----
  // Se o webhook trouxe indicação de venda/conversão e o cliente tem Pixel e Token cadastrados:
  let autoTracked = false;
  let autoTrackMessage: string | null = null;

  const rawEvent = String(fields.event_name || fields.event || fields.evento || "").trim();
  const rawStatus = String(fields.status || fields.lead_status || "").toLowerCase().trim();
  const rawValue = fields.value ?? fields.valor ?? fields.preco ?? fields.price ?? fields.amount;
  const numValue = rawValue !== undefined && rawValue !== null && rawValue !== "" ? Number(rawValue) : null;
  const isWon = ["won", "ganho", "aprovado", "pago", "compra", "venda", "paid"].includes(rawStatus);

  const eventName = rawEvent || (isWon || (numValue !== null && numValue > 0) ? "Purchase" : null);

  if (eventName && client.pixel_id && client.capi_token_enc) {
    try {
      const lead = await getLead(result.leadId);
      if (lead) {
        const secret = await appSecret();
        const token = decrypt(client.capi_token_enc, secret);
        const eventId = randomUUID();
        const eventTime = new Date();

        const built = buildEvent({
          client,
          lead,
          eventName,
          eventId,
          eventTime,
          value: Number.isFinite(numValue) ? numValue : null,
          currency: String(fields.currency || client.default_currency || "BRL").toUpperCase(),
          contentName: String(fields.content_name || fields.produto || fields.product || "").trim() || null,
          allowFallbackWithoutPageId: true,
        });

        if (built.errors.length === 0) {
          const sendRes = await sendEvent({
            apiVersion: metaApiVersion(),
            pixelId: client.pixel_id,
            accessToken: token,
            event: built.event,
            testEventCode: client.test_event_code,
            autoFallback: true,
          });

          await insertEvent({
            client_id: client.id,
            lead_id: lead.id,
            event_name: String(built.event.event_name),
            event_id: eventId,
            event_time: eventTime.toISOString(),
            value: numValue,
            currency: client.default_currency,
            content_name: String(fields.content_name || fields.produto || "").trim() || null,
            action_source: sendRes.recovered ? "chat" : built.actionSource,
            is_test: !!client.test_event_code,
            status: sendRes.ok ? "enviado" : "erro",
            http_status: sendRes.httpStatus,
            events_received: sendRes.eventsReceived,
            fbtrace_id: sendRes.fbtraceId,
            error_message: sendRes.recovered
              ? "Recuperado automaticamente via telefone"
              : sendRes.errorMessage,
            payload: sendRes.body,
            response: sendRes.response,
          });

          autoTracked = sendRes.ok;
          autoTrackMessage = sendRes.ok ? "Conversão enviada automaticamente ao Meta." : sendRes.errorMessage;
        }
      }
    } catch (e) {
      autoTrackMessage = e instanceof Error ? e.message : String(e);
    }
  }

  return NextResponse.json({
    ok: true,
    lead_id: result.leadId,
    created: result.created,
    auto_tracked: autoTracked,
    auto_track_message: autoTrackMessage,
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  return handle(req, (await ctx.params).key);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  return handle(req, (await ctx.params).key);
}
