import { NextResponse, type NextRequest } from "next/server";
import { getNativeWhatsAppStatus } from "@/lib/whatsapp-baileys";
import { listClients } from "@/lib/store";
import { authorizeWahaRequest } from "../../../_auth";

export const dynamic = "force-dynamic";

/**
 * Rota compatível com WAHA: GET /api/{session}/auth/qr
 * Retorna o QR Code em PNG ou JSON
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

    const status = await getNativeWhatsAppStatus(client.id, {
      reconnect: false,
    });

    if (!status.qrcode) {
      if (status.state === "open") {
        return NextResponse.json(
          { message: "Already connected", status: "WORKING", qr: null },
          { status: 200 },
        );
      }
      return NextResponse.json(
        {
          message: "Inicie a sessão para gerar um QR Code.",
          status: status.state === "connecting" ? "STARTING" : "STOPPED",
          qr: null,
        },
        { status: 200 },
      );
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
  } catch {
    return NextResponse.json(
      { message: "Não foi possível consultar o QR Code." },
      { status: 500 },
    );
  }
}
