import { NextResponse, type NextRequest } from "next/server";
import { getNativeWhatsAppStatus, connectNativeWhatsApp } from "@/lib/whatsapp-baileys";
import { listClients } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Rota compatível com WAHA: GET /api/{session}/auth/qr
 * Retorna o QR Code em PNG ou JSON
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ session: string }> }
) {
  try {
    const { session } = await ctx.params;
    const clients = await listClients();
    const client = clients.find((c) => c.name.toLowerCase().replace(/\W+/g, "_") === session || c.id === session) || clients[0];

    if (!client) {
      return NextResponse.json({ message: "Session not found" }, { status: 404 });
    }

    let status = await getNativeWhatsAppStatus(client.id);
    if (!status.qrcode && status.state !== "open") {
      const conn = await connectNativeWhatsApp(client.id);
      status = { ...status, qrcode: conn.qrcode };
    }

    if (!status.qrcode) {
      if (status.state === "open" || status.phone) {
        return NextResponse.json({ message: "Already connected", status: "WORKING", qr: null }, { status: 200 });
      }
      return NextResponse.json({ message: "Starting", status: "STARTING", qr: null }, { status: 200 });
    }

    const accept = req.headers.get("accept") || "";
    // Se o cliente pede JSON
    if (accept.includes("application/json")) {
      return NextResponse.json({
        qr: status.qrcode,
        status: "SCAN_QR_CODE",
      });
    }

    // Se pede imagem direta (PNG)
    const base64Data = status.qrcode.replace(/^data:image\/png;base64,/, "");
    const imgBuffer = Buffer.from(base64Data, "base64");

    return new NextResponse(imgBuffer, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json({ message: String(err) }, { status: 500 });
  }
}
