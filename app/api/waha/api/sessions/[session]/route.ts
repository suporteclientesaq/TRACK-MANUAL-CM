import { NextResponse, type NextRequest } from "next/server";
import {
  getNativeWhatsAppStatus,
  connectNativeWhatsApp,
  disconnectNativeWhatsApp,
} from "@/lib/whatsapp-baileys";
import { listClients } from "@/lib/store";
import { authorizeWahaRequest } from "../../_auth";

export const dynamic = "force-dynamic";

/**
 * Roteador compatível com a API oficial do WAHA (GET /api/sessions/{session})
 * Traduz chamadas do formato WAHA diretamente para o motor nativo do Track Manual!
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ session: string }> },
) {
  const unauthorized = await authorizeWahaRequest(req);
  if (unauthorized) return unauthorized;
  try {
    const { session } = await ctx.params;
    const clients = await listClients();
    const client = clients.find(
      (c) =>
        c.name.toLowerCase().replace(/\W+/g, "_") === session ||
        c.id === session,
    );

    if (!client) {
      return NextResponse.json(
        { message: "Session not found" },
        { status: 404 },
      );
    }

    const st = await getNativeWhatsAppStatus(client.id, { reconnect: false });

    // Mapeia status do Baileys para o formato oficial do WAHA
    let wahaStatus = "STOPPED";
    if (st.state === "open") {
      wahaStatus = "WORKING";
    } else if (st.state === "connecting") {
      wahaStatus = st.qrcode ? "SCAN_QR_CODE" : "STARTING";
    }

    return NextResponse.json(
      {
        name: session,
        status: wahaStatus,
        qrcode: st.qrcode || null,
        config: {},
        me: st.phone
          ? { id: `${st.phone}@c.us`, pushName: st.name || "WhatsApp" }
          : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { message: "Não foi possível consultar a sessão." },
      { status: 500 },
    );
  }
}

/**
 * POST /api/sessions/{session} ou POST /api/sessions/start
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ session: string }> },
) {
  const unauthorized = await authorizeWahaRequest(req);
  if (unauthorized) return unauthorized;
  try {
    let { session } = await ctx.params;
    const operation = session;
    let body: any = null;
    try {
      body = await req.json();
    } catch {}

    if ((session === "start" || session === "stop") && body?.name) {
      session = String(body.name);
    }

    const clients = await listClients();
    const client = clients.find(
      (c) =>
        c.name.toLowerCase().replace(/\W+/g, "_") === session ||
        c.id === session,
    );

    if (!client) {
      return NextResponse.json(
        { message: "Client not found" },
        { status: 404 },
      );
    }

    if (operation === "stop") {
      await disconnectNativeWhatsApp(client.id);
      return NextResponse.json(
        { name: client.id, status: "STOPPED" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const res = await connectNativeWhatsApp(client.id);
    if (!res.ok) {
      return NextResponse.json(
        {
          message: res.error || "Não foi possível iniciar a sessão.",
          status: "STOPPED",
        },
        { status: 503 },
      );
    }
    const status = res.state === "open" ? "WORKING" : "SCAN_QR_CODE";

    return NextResponse.json(
      {
        name: session,
        status,
        qrcode: res.qrcode || null,
        me: res.phone
          ? { id: `${res.phone}@c.us`, pushName: "WhatsApp" }
          : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { message: "Não foi possível iniciar a sessão." },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/sessions/{session}
 */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ session: string }> },
) {
  const unauthorized = await authorizeWahaRequest(req);
  if (unauthorized) return unauthorized;
  try {
    let { session } = await ctx.params;
    let body: any = null;
    try {
      body = await req.json();
    } catch {}

    if (session === "stop" && body?.name) {
      session = String(body.name);
    }

    const clients = await listClients();
    const client = clients.find(
      (c) =>
        c.name.toLowerCase().replace(/\W+/g, "_") === session ||
        c.id === session,
    );

    if (!client) {
      return NextResponse.json(
        { message: "Client not found" },
        { status: 404 },
      );
    }

    await disconnectNativeWhatsApp(client.id);
    return NextResponse.json(
      { name: session, status: "STOPPED" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { message: "Não foi possível encerrar a sessão." },
      { status: 500 },
    );
  }
}
