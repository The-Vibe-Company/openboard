import { timingSafeEqual } from "node:crypto";
import { BoardError } from "@openboard/contract";
import type { PersonRecord, PlatformView } from "@openboard/ports";
import { hashToken } from "./secrets.ts";

/** A person's signed-in browser (docs/auth.md "Sessions and CSRF"). */
export const SESSION_COOKIE = "__Host-ob_session";
export const CSRF_HEADER = "x-ob-csrf";

const DAY = 86_400_000;
/** 30 days absolute, 7 days idle; `seen_at` moves at most once an hour, so reads rarely write. */
const LIFETIME = 30 * DAY;
const IDLE = 7 * DAY;
const TOUCH_AFTER = 3_600_000;
/** A cookie value: 32 random bytes as base64url. */
const VALUE = /^[A-Za-z0-9_-]{43}$/;

/** The person a session cookie signs in, and the CSRF value their cookie-authenticated writes send. */
export interface Session {
  readonly person: PersonRecord;
  readonly csrf: string;
}

/** The value of the cookie `name` the request carries, or null. */
export function cookieOf(request: Request, name: string): string | null {
  for (const pair of (request.headers.get("cookie") ?? "").split(";")) {
    const at = pair.indexOf("=");
    if (at > 0 && pair.slice(0, at).trim() === name) return pair.slice(at + 1).trim();
  }
  return null;
}

/** A `__Host-` cookie: secure, script-proof, sent on top-level navigations; `maxAge` 0 deletes it. */
export function hostCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

/** A fresh session: its cookie, and what is stored of it, the cookie value's SHA-256, never the value. */
export function mintSession(randomBytes: (length: number) => Uint8Array, now: number) {
  const value = base64url(randomBytes(32));
  return {
    cookie: hostCookie(SESSION_COOKIE, value, LIFETIME / 1000),
    record: { idHash: hashToken(value), csrf: base64url(randomBytes(32)), expiresAt: now + LIFETIME },
  };
}

/** Whether `given` equals `expected`, compared in constant time. */
export function sameText(given: string | null, expected: string): boolean {
  if (given === null || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/** A cookie-authenticated write needs `Origin` equal to the public origin and `x-ob-csrf` equal to the session's. */
function checkCsrf(request: Request, csrf: string, publicUrl: string): void {
  if (request.method === "GET" || request.method === "HEAD") return;
  if (request.headers.get("origin") === publicUrl && sameText(request.headers.get(CSRF_HEADER), csrf)) return;
  throw new BoardError("forbidden", "a signed-in write needs this server's Origin and the session's CSRF value", {
    hint: `Send the csrf value of GET /api/x/session as ${CSRF_HEADER}.`,
  });
}

/**
 * The session a request's cookie names, when it is live: not revoked, used within 7 days, younger than 30. Only a
 * request without an `authorization` header is read by its cookie (docs/auth.md "The verifier chain", step 6).
 */
export async function sessionOf(
  request: Request,
  platform: PlatformView,
  now: number,
  publicUrl: string,
): Promise<Session | null> {
  if (request.headers.has("authorization")) return null;
  const value = cookieOf(request, SESSION_COOKIE);
  if (value === null || !VALUE.test(value)) return null;
  const idHash = hashToken(value);
  const record = await platform.session(idHash);
  if (!record || now >= record.expiresAt || now - record.seenAt >= IDLE) return null;
  if (now - record.seenAt >= TOUCH_AFTER) await platform.touchSession(idHash, now);
  checkCsrf(request, record.csrf, publicUrl);
  return { person: record.person, csrf: record.csrf };
}
