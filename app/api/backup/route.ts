import { NextResponse } from "next/server";
import fs from "node:fs";
import { requireAuth } from "@/lib/auth";
import { isOnline, localPaths } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  await requireAuth();

  if (isOnline()) {
    return NextResponse.json(
      { ok: false, error: "Backup local de arquivo disponível apenas no modo SQLite local." },
      { status: 400 }
    );
  }

  const paths = localPaths();
  if (!paths?.db || !fs.existsSync(paths.db)) {
    return NextResponse.json(
      { ok: false, error: "Arquivo do banco de dados não encontrado no disco." },
      { status: 404 }
    );
  }

  const fileBuffer = fs.readFileSync(paths.db);
  const now = new Date().toISOString().slice(0, 10);

  return new NextResponse(fileBuffer, {
    headers: {
      "Content-Type": "application/x-sqlite3",
      "Content-Disposition": `attachment; filename="track-manual-backup-${now}.db"`,
    },
  });
}
