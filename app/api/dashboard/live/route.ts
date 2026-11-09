import { NextResponse, type NextRequest } from "next/server";
import { isLoggedIn } from "@/lib/auth";
import { getDashboardData } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    if (!(await isLoggedIn()))
      return NextResponse.json(
        { ok: false, error: "Sua sessão expirou. Entre novamente." },
        { status: 401 },
      );
    const { searchParams } = new URL(req.url);
    const clientId = searchParams.get("cliente") || null;
    const period = searchParams.get("periodo") || "hoje";
    const status = searchParams.get("status_campanha");

    const data = await getDashboardData({
      clientId,
      period,
      campaignStatus:
        status === "all" || status === "paused" ? status : "active",
      campaignIds: (searchParams.get("campanhas") || "")
        .split(",")
        .filter((id) => /^\d{1,30}$/.test(id))
        .slice(0, 200),
    });

    return NextResponse.json(
      { ok: true, data, timestamp: new Date().toISOString() },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
