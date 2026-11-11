import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  socket: vi.fn(),
  auth: { creds: { registered: false }, keys: {} },
  qr: vi.fn(async () => "data:image/png;base64,fixture"),
}));
vi.mock("@whiskeysockets/baileys", () => ({
  default: fake.socket,
  DisconnectReason: { loggedOut: 401, restartRequired: 515 },
  useMultiFileAuthState: async () => ({ state: fake.auth, saveCreds: vi.fn() }),
  downloadMediaMessage: vi.fn(),
}));
vi.mock("qrcode", () => ({ default: { toDataURL: fake.qr } }));
vi.mock("@/lib/store", () => ({
  getSetting: async () => null,
  setSettings: async () => {},
}));
vi.mock("@/lib/ingest", () => ({ ingestLead: vi.fn() }));
vi.mock("@/lib/config", () => ({ appSecret: async () => "fixture" }));
import { connectNativeWhatsApp, getNativeWhatsAppStatus } from "@/lib/whatsapp-baileys";

let directory: string;
let ev: EventEmitter;
const client = "pairing-test";
const state = globalThis as unknown as {
  __nativeWhatsAppSessions: Map<string, unknown>;
  __nativeWhatsAppConnects: Map<string, unknown>;
};
beforeEach(() => {
  vi.useFakeTimers();
  for (const key of ["NETLIFY", "VERCEL", "AWS_LAMBDA_FUNCTION_NAME"])
    vi.stubEnv(key, "");
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "track-pairing-"));
  vi.stubEnv("TRACK_DATA_DIR", directory);
  state.__nativeWhatsAppSessions.clear();
  state.__nativeWhatsAppConnects.clear();
  fake.auth.creds.registered = false;
  fake.qr.mockReset().mockResolvedValue("data:image/png;base64,fixture");
  fake.socket.mockReset().mockImplementation(() => {
    ev = new EventEmitter();
    return { ev, end: vi.fn(), user: null };
  });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  fs.rmSync(directory, { recursive: true, force: true });
});

async function start() {
  const result = connectNativeWhatsApp(client);
  await vi.advanceTimersByTimeAsync(0);
  expect(fake.socket).toHaveBeenCalledTimes(1);
  return { result };
}
function close(code: number) {
  ev.emit("connection.update", {
    connection: "close",
    lastDisconnect: { error: { output: { statusCode: code } } },
  });
}

describe("pareamento nativo", () => {
  it("encerra a espera imediatamente e conserva o erro sem repetir uma sessão não pareada", async () => {
    const { result } = await start();
    close(405);
    expect(await result).toMatchObject({ ok: false, state: "close", qrcode: null });
    expect((await getNativeWhatsAppStatus(client)).error).toContain("405");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fake.socket).toHaveBeenCalledTimes(1);
  });
  it("entrega o QR e reaproveita a conexão em cliques simultâneos", async () => {
    const { result } = await start();
    const same = connectNativeWhatsApp(client);
    expect(same).toBe(result);
    ev.emit("connection.update", { qr: "fixture" });
    expect(await result).toMatchObject({ ok: true, state: "connecting", qrcode: "data:image/png;base64,fixture" });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("remove a espera vencida e ainda permite consultar o QR que chegar depois", async () => {
    const { result } = await start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toMatchObject({ state: "connecting", qrcode: null });
    ev.emit("connection.update", { qr: "fixture" });
    await vi.advanceTimersByTimeAsync(0);
    expect(await getNativeWhatsAppStatus(client)).toMatchObject({ qrcode: "data:image/png;base64,fixture" });
  });
  it("descarta a imagem do QR se a conexão fechar durante a conversão", async () => {
    let finish!: (value: string) => void;
    fake.qr.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result } = await start();
    ev.emit("connection.update", { qr: "fixture" });
    close(428);
    finish("data:image/png;base64,stale");
    await result;
    expect(await getNativeWhatsAppStatus(client)).toMatchObject({ state: "close", qrcode: null });
  });
  it.each([false, true])("reconecta após o restart de pareamento ou a queda de sessão salva (%s)", async registered => {
    fake.auth.creds.registered = registered;
    const { result } = await start();
    close(registered ? 428 : 515);
    await result;
    await vi.advanceTimersByTimeAsync(3000);
    expect(fake.socket).toHaveBeenCalledTimes(2);
    ev.emit("connection.update", { connection: "open" });
    await vi.advanceTimersByTimeAsync(0);
    expect(await getNativeWhatsAppStatus(client)).toMatchObject({ ok: true, state: "open", error: undefined });
  });
});
