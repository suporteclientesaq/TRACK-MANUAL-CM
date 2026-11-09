import { NextResponse } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isLoggedIn } from "@/lib/auth";
import { isOnline, localPaths } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isLoggedIn())) {
    return NextResponse.json(
      { ok: false, error: "Autenticação necessária." },
      { status: 401 },
    );
  }

  if (isOnline()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Backup local de arquivo disponível apenas no modo SQLite local.",
      },
      { status: 400 },
    );
  }

  const paths = localPaths();
  if (!paths?.db || !fs.existsSync(paths.db)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Arquivo do banco de dados não encontrado no disco.",
      },
      { status: 404 },
    );
  }

  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "track-manual-backup-"),
  );
  try {
    // VACUUM INTO produz um snapshot consistente, incluindo commits ainda no
    // WAL, sem interromper a conexão usada pelo painel. Funciona no Node 22.13.
    const sqlite = process.getBuiltinModule(
      "node:sqlite",
    ) as typeof import("node:sqlite");
    const connection = new sqlite.DatabaseSync(paths.db, { readOnly: true });
    const snapshot = path.join(temporary, "snapshot.db");
    try {
      connection.exec("pragma busy_timeout = 5000");
      connection.prepare("VACUUM INTO ?").run(snapshot);
    } finally {
      connection.close();
    }

    const fileBuffer = fs.readFileSync(snapshot);
    const now = new Date().toISOString().slice(0, 10);
    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": "application/x-sqlite3",
        "Content-Disposition": `attachment; filename="track-manual-backup-${now}.db"`,
        "Cache-Control": "no-store, private",
        // O segredo nunca acompanha o banco em um download comum. A instalação
        // deve preservar config.json/APP_SECRET separadamente para ler tokens.
        "X-Backup-Recovery":
          "Preserve config.json or APP_SECRET separately; WhatsApp sessions are not included.",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "Não foi possível criar um backup consistente. Tente novamente.",
      },
      { status: 500 },
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
