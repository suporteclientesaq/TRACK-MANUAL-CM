import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authenticated: false,
  online: false,
  file: "",
}));
vi.mock("@/lib/auth", () => ({ isLoggedIn: async () => state.authenticated }));
vi.mock("@/lib/store", () => ({
  isOnline: () => state.online,
  localPaths: () => ({ db: state.file, config: "config.json" }),
}));
let directory = "";
let database: DatabaseSync | undefined;
beforeEach(() => {
  state.authenticated = false;
  state.online = false;
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "track-backup-test-"));
  state.file = path.join(directory, "original.db");
});
afterEach(() => {
  database?.close();
  database = undefined;
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("backup consistente", () => {
  it("nega download anônimo com 401", async () => {
    const route = await import("@/app/api/backup/route");
    expect((await route.GET()).status).toBe(401);
  });

  it("inclui commits ainda no WAL sem fechar o banco ativo", async () => {
    state.authenticated = true;
    database = new DatabaseSync(state.file);
    database.exec(
      "pragma journal_mode=wal; create table leads (id text); insert into leads values ('confirmado');",
    );
    const route = await import("@/app/api/backup/route");
    const response = await route.GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-backup-recovery")).toContain(
      "APP_SECRET separately",
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
    const downloaded = path.join(directory, "download.db");
    fs.writeFileSync(downloaded, Buffer.from(await response.arrayBuffer()));
    const restored = new DatabaseSync(downloaded);
    try {
      expect(restored.prepare("select id from leads").get()?.id).toBe(
        "confirmado",
      );
      expect(database.prepare("select count(*) n from leads").get()?.n).toBe(1);
    } finally {
      restored.close();
    }
  });
});
