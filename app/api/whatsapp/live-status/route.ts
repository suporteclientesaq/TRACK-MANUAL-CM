import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { listClients } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuth();
    const clients = await listClients();
    if (clients.length === 0) {
      return NextResponse.json({ online: false, count: 0, state: "no_clients" });
    }

    const { getNativeWhatsAppStatus } = await import("@/lib/whatsapp-baileys");

    let onlineCount = 0;
    for (const client of clients) {
      const status = await getNativeWhatsAppStatus(client.id);
      if (status.state === "open") {
        onlineCount++;
      }
    }

    return NextResponse.json({
      online: onlineCount > 0,
      count: onlineCount,
      totalClients: clients.length,
      state: onlineCount > 0 ? "open" : "close",
    });
  } catch (e) {
    return NextResponse.json({ online: false, count: 0, error: String(e) });
  }
}
