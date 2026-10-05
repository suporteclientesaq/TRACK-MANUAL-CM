import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getClient } from "@/lib/store";

export const dynamic = "force-dynamic";

// GET /api/whatsapp/[clientId]/status
export async function GET(_req: NextRequest, ctx: { params: Promise<{ clientId: string }> }) {
  try {
    await requireAuth();
    const { clientId } = await ctx.params;
    const { getNativeWhatsAppStatus } = await import("@/lib/whatsapp-baileys");
    const result = getNativeWhatsAppStatus(clientId);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

// POST /api/whatsapp/[clientId]/status  → connect
export async function POST(_req: NextRequest, ctx: { params: Promise<{ clientId: string }> }) {
  try {
    await requireAuth();
    const { clientId } = await ctx.params;

    const client = await getClient(clientId);
    if (!client) {
      return NextResponse.json({ ok: false, error: "Cliente não encontrado." });
    }

    const { connectNativeWhatsApp } = await import("@/lib/whatsapp-baileys");
    const result = await connectNativeWhatsApp(clientId);

    // Garante que o resultado é totalmente serializável (sem undefined)
    return NextResponse.json({
      ok: result.ok,
      state: result.state,
      qrcode: result.qrcode ?? null,
      phone: result.phone ?? null,
      error: result.error ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, state: "close", qrcode: null, error: msg });
  }
}

// DELETE /api/whatsapp/[clientId]/status  → disconnect
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ clientId: string }> }) {
  try {
    await requireAuth();
    const { clientId } = await ctx.params;
    const { disconnectNativeWhatsApp } = await import("@/lib/whatsapp-baileys");
    const result = await disconnectNativeWhatsApp(clientId);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
