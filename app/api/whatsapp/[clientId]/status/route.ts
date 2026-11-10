import { NextResponse, type NextRequest } from "next/server";
import { isLoggedIn } from "@/lib/auth";
import { getClient } from "@/lib/store";
import {
  channelStatus,
  connectChannel,
  disconnectChannel,
  saveChannelConfiguration,
} from "@/lib/channels";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ clientId: string }> };
async function authorize(ctx: Context) {
  if (!(await isLoggedIn()))
    return NextResponse.json(
      { ok: false, error: "Autenticação necessária." },
      { status: 401 },
    );
  const { clientId } = await ctx.params;
  if (!(await getClient(clientId)))
    return NextResponse.json(
      { ok: false, error: "Cliente não encontrado." },
      { status: 404 },
    );
  return clientId;
}
export async function GET(_req: NextRequest, ctx: Context) {
  try {
    const clientId = await authorize(ctx);
    if (typeof clientId !== "string") return clientId;
    return NextResponse.json(await channelStatus(clientId), {
      headers: { "Cache-Control": "private,no-store" },
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        state: "close",
        qrcode: null,
        phone: null,
        error: "Não foi possível consultar o canal.",
      },
      { status: 502 },
    );
  }
}
export async function POST(req: NextRequest, ctx: Context) {
  const clientId = await authorize(ctx);
  if (typeof clientId !== "string") return clientId;
  try {
    await saveChannelConfiguration(clientId, { provider: "native" });
    return NextResponse.json(
      await connectChannel(clientId, req.nextUrl.origin),
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        state: "close",
        error: "Não foi possível conectar o canal.",
      },
      { status: 502 },
    );
  }
}
export async function DELETE(_req: NextRequest, ctx: Context) {
  const clientId = await authorize(ctx);
  if (typeof clientId !== "string") return clientId;
  try {
    return NextResponse.json(await disconnectChannel(clientId));
  } catch {
    return NextResponse.json(
      { ok: false, error: "Não foi possível desconectar o canal." },
      { status: 502 },
    );
  }
}
