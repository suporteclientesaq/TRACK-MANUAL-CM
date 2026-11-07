import { NextResponse, type NextRequest } from "next/server";
import { getNativeWhatsAppStatus, connectNativeWhatsApp, disconnectNativeWhatsApp } from "@/lib/whatsapp-baileys";
import { listClients } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Roteador compatível com a API oficial do WAHA (GET /api/sessions/{session})
 * Traduz chamadas do formato WAHA diretamente para o motor nativo do Track Manual!
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ session: string }> }
) {
  try {
    const { session } = await ctx.params;
    const clients = await listClients();
    const client = clients.find((c) => c.name.toLowerCase().replace(/\W+/g, "_") === session || c.id === session) || clients[0];

    if (!client) {
      return NextResponse.json({ message: "Session not found" }, { status: 404 });
    }

    const st = getNativeWhatsAppStatus(client.id);

    // Mapeia status do Baileys para o formato oficial do WAHA
    let wahaStatus = "STOPPED";
    if (st.state === "open" || (st.phone && !st.qrcode)) {
      wahaStatus = "WORKING";
    } else if (st.state === "connecting") {
      wahaStatus = st.qrcode ? "SCAN_QR_CODE" : "STARTING";
    }

    return NextResponse.json({
      name: session,
      status: wahaStatus,
      qrcode: st.qrcode || null,
      config: {},
      me: st.phone ? { id: `${st.phone}@c.us`, pushName: st.name || "WhatsApp" } : null,
    });
  } catch (err) {
    return NextResponse.json({ message: String(err) }, { status: 500 });
  }
}

/**
 * POST /api/sessions/{session} ou POST /api/sessions/start
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ session: string }> }
) {
  try {
    let { session } = await ctx.params;
    let body: any = null;
    try {
      body = await req.json();
    } catch {}

    if ((session === "start" || session === "stop") && body?.name) {
      session = String(body.name);
    }

    const clients = await listClients();
    const client = clients.find((c) => c.name.toLowerCase().replace(/\W+/g, "_") === session || c.id === session) || clients[0];

    if (!client) {
      return NextResponse.json({ message: "Client not found" }, { status: 404 });
    }

    const res = await connectNativeWhatsApp(client.id);
    const status = res.state === "open" ? "WORKING" : "SCAN_QR_CODE";

    return NextResponse.json({
      name: session,
      status,
      qrcode: res.qrcode || null,
      me: res.phone ? { id: `${res.phone}@c.us`, pushName: "WhatsApp" } : null,
    });
  } catch (err) {
    return NextResponse.json({ message: String(err) }, { status: 500 });
  }
}

/**
 * DELETE /api/sessions/{session}
 */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ session: string }> }
) {
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
    const client = clients.find((c) => c.name.toLowerCase().replace(/\W+/g, "_") === session || c.id === session) || clients[0];

    if (!client) {
      return NextResponse.json({ message: "Client not found" }, { status: 404 });
    }

    await disconnectNativeWhatsApp(client.id);
    return NextResponse.json({ name: session, status: "STOPPED" });
  } catch (err) {
    return NextResponse.json({ message: String(err) }, { status: 500 });
  }
}
