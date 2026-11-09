import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createHash } from "node:crypto";
import { sessionSecret, verifyPassword } from "./config";
import { signSession, verifySession } from "./crypto";

const COOKIE = "tm_sessao";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_ATTEMPTS = 8;
const globalAuth = globalThis as unknown as {
  __trackLoginAttempts?: Map<string, { count: number; until: number }>;
};
const attempts = (globalAuth.__trackLoginAttempts ??= new Map());

export async function isLoggedIn(): Promise<boolean> {
  const jar = await cookies();
  const cookie = jar.get(COOKIE)?.value;
  if (!cookie) return false;
  try {
    const secret = await sessionSecret();
    return !!secret && verifySession(cookie, secret, Date.now());
  } catch {
    return false;
  }
}

/** Use no topo de toda página e de toda ação protegida. */
export async function requireAuth(): Promise<void> {
  if (!(await isLoggedIn())) redirect("/login");
}

export async function login(password: string): Promise<boolean> {
  const h = await headers();
  // Complementa o rate limit do proxy. Em múltiplas réplicas, configure o limite
  // também na borda; o contador local não é compartilhado entre processos.
  const address = (
    h.get("x-forwarded-for")?.split(",")[0] ||
    h.get("x-real-ip") ||
    "local"
  ).trim();
  const bucket = createHash("sha256").update(address).digest("hex");
  const now = Date.now();
  for (const [key, entry] of attempts)
    if (entry.until <= now) attempts.delete(key);
  if (attempts.size >= 10_000 && !attempts.has(bucket)) return false;
  const entry = attempts.get(bucket) || {
    count: 0,
    until: now + LOGIN_WINDOW_MS,
  };
  if (entry.count >= LOGIN_ATTEMPTS) return false;
  entry.count += 1;
  attempts.set(bucket, entry);
  if (!(await verifyPassword(password))) return false;
  attempts.delete(bucket);
  await startSession();
  return true;
}

export async function startSession(): Promise<void> {
  const secret = await sessionSecret();
  if (!secret) throw new Error("Cadastre a senha antes de iniciar uma sessão.");
  const expires = Date.now() + THIRTY_DAYS_MS;
  const h = await headers();
  // No Netlify/Vercel a página chega por https; no computador, por http://localhost.
  const https =
    (h.get("x-forwarded-proto") || "").split(",")[0].trim() === "https";
  const jar = await cookies();
  jar.set(COOKIE, signSession(expires, secret), {
    httpOnly: true,
    secure: https,
    sameSite: "lax",
    path: "/",
    expires: new Date(expires),
  });
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}
