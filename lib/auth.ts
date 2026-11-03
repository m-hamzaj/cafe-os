import "server-only";
import { timingSafeEqual, createHmac } from "node:crypto";
import { cookies } from "next/headers";

export { hashPin, verifyPin } from "@/lib/pin";

const SESSION_COOKIE = "cafeos_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h -- a single shift, not a long-lived login

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not set. Add it to .env.local (any long random string).");
  }
  return secret;
}

export interface Session {
  staffId: number;
  role: "owner" | "cashier";
  name: string;
}

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("hex");
}

function encodeSession(session: Session, expiresAt: number): string {
  const payload = JSON.stringify({ ...session, expiresAt });
  const payloadB64 = Buffer.from(payload, "utf-8").toString("base64url");
  const signature = sign(payloadB64);
  return `${payloadB64}.${signature}`;
}

function decodeSession(token: string): Session | null {
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) return null;

  const expectedSig = sign(payloadB64);
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
    if (typeof payload.expiresAt !== "number" || payload.expiresAt < Date.now()) return null;
    return { staffId: payload.staffId, role: payload.role, name: payload.name };
  } catch {
    return null;
  }
}

export async function createSession(session: Session): Promise<void> {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const token = encodeSession(session, expiresAt);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return decodeSession(token);
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
