import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { appSecret, verifyPassword } from "./config";
import { signSession, verifySession } from "./crypto";

const COOKIE = "tm_sessao";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function isLoggedIn(): Promise<boolean> {
  const jar = await cookies();
  return verifySession(jar.get(COOKIE)?.value, await appSecret(), Date.now());
}

/** Use no topo de toda página e de toda ação protegida. */
export async function requireAuth(): Promise<void> {
  if (!(await isLoggedIn())) redirect("/login");
}

export async function login(password: string): Promise<boolean> {
  if (!(await verifyPassword(password))) return false;
  await startSession();
  return true;
}

export async function startSession(): Promise<void> {
  const expires = Date.now() + THIRTY_DAYS_MS;
  const h = await headers();
  // No Netlify/Vercel a página chega por https; no computador, por http://localhost.
  const https = (h.get("x-forwarded-proto") || "").split(",")[0].trim() === "https";
  const jar = await cookies();
  jar.set(COOKIE, signSession(expires, await appSecret()), {
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
