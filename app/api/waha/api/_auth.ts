import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { isLoggedIn } from "@/lib/auth";

/** UI usa cookie; integrações de servidor podem usar uma chave própria do WAHA. */
export async function authorizeWahaRequest(
  req: NextRequest,
): Promise<NextResponse | null> {
  const configured = process.env.TRACK_WAHA_API_KEY?.trim();
  const provided =
    req.headers.get("x-api-key") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (configured && configured.length >= 32 && provided) {
    const expected = Buffer.from(configured);
    const given = Buffer.from(provided);
    if (expected.length === given.length && timingSafeEqual(expected, given))
      return null;
  }

  if (!(await isLoggedIn())) {
    return NextResponse.json(
      { ok: false, message: "Autenticação necessária." },
      {
        status: 401,
        headers: { "Cache-Control": "no-store", "WWW-Authenticate": "Bearer" },
      },
    );
  }

  const origin = req.headers.get("origin");
  if (
    !["GET", "HEAD"].includes(req.method) &&
    origin &&
    origin !== new URL(req.url).origin
  ) {
    return NextResponse.json(
      { ok: false, message: "Origem da requisição não permitida." },
      { status: 403 },
    );
  }
  return null;
}
