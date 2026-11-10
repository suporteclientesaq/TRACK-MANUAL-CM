import { NextResponse } from "next/server";
import { isLoggedIn } from "@/lib/auth";
import { listClients } from "@/lib/store";
import { channelStatus } from "@/lib/channels";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!(await isLoggedIn()))
    return NextResponse.json(
      { online: false, count: 0, error: "Autenticação necessária." },
      { status: 401 },
    );
  const clients = await listClients();
  let count = 0;
  let errors = 0;
  for (let offset = 0; offset < clients.length; offset += 6) {
    const results = await Promise.all(
      clients.slice(offset, offset + 6).map(async (client) => {
        try {
          return await channelStatus(client.id, { includeQr: false });
        } catch {
          return { ok: false, state: "close" };
        }
      }),
    );
    for (const result of results) {
      if (result.ok && result.state === "open") count++;
      if (!result.ok) errors++;
    }
  }
  return NextResponse.json(
    {
      online: count > 0,
      count,
      totalClients: clients.length,
      errorCount: errors,
      state:
        errors === clients.length && errors > 0
          ? "unknown"
          : count > 0
            ? "open"
            : "close",
    },
    { headers: { "Cache-Control": "private,no-store" } },
  );
}
