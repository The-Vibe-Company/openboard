import { timingSafeEqual } from "node:crypto";
import { BoardError } from "@openboard/contract";
import type { PersonRecord, PlatformView, SessionRecord } from "@openboard/ports";
import { callerCan, credentialKind, memberOf, type Principal } from "../deps.ts";
import { boardMember } from "../http/scope.ts";
import { personGrantCan } from "./access.ts";
import type { CredentialVerifier } from "./chain.ts";
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
  const [left, right] = [Buffer.from(given ?? ""), Buffer.from(expected)];
  return given !== null && left.length === right.length && timingSafeEqual(left, right);
}

/** A cookie-authenticated write needs `Origin` equal to the public origin and `x-ob-csrf` equal to the session's. */
function checkCsrf(request: Request, csrf: string, publicUrl: string): void {
  if (request.method === "GET" || request.method === "HEAD") return;
  if (request.headers.get("origin") === publicUrl && sameText(request.headers.get(CSRF_HEADER), csrf)) return;
  throw new BoardError("forbidden", "a signed-in write needs this server's Origin and the session's CSRF value", {
    hint: `Send the csrf value of GET /api/x/session as ${CSRF_HEADER}.`,
  });
}

/** A live session before its CSRF proof: the stored record and the hash of the cookie value that names it. */
export interface LiveSession {
  readonly idHash: string;
  readonly record: SessionRecord;
}

/**
 * The session a request's cookie names, when it is live: not revoked, used within 7 days, younger than 30. Only a
 * request without an `authorization` header is read by its cookie (docs/auth.md "The verifier chain", step 6). It is
 * not yet proven for a write nor renewed: `proveSession` does both, after the caller has checked the tenant.
 */
export async function liveSession(request: Request, platform: PlatformView, now: number): Promise<LiveSession | null> {
  if (request.headers.has("authorization")) return null;
  const value = cookieOf(request, SESSION_COOKIE);
  if (value === null || !VALUE.test(value)) return null;
  const idHash = hashToken(value);
  const record = await platform.session(idHash);
  if (!record || now >= record.expiresAt || now - record.seenAt >= IDLE) return null;
  return { idHash, record };
}

/** A write without the CSRF proof is refused before the session is touched, so a refused write never renews it. */
export async function proveSession(
  request: Request,
  { idHash, record }: LiveSession,
  platform: PlatformView,
  now: number,
  publicUrl: string,
): Promise<Session> {
  checkCsrf(request, record.csrf, publicUrl);
  if (now - record.seenAt >= TOUCH_AFTER) await platform.touchSession(idHash, now);
  return { person: record.person, csrf: record.csrf };
}

/** The live session a request's cookie names, proven for a write and renewed; for routes that name no tenant. */
export async function sessionOf(
  request: Request,
  platform: PlatformView,
  now: number,
  publicUrl: string,
): Promise<Session | null> {
  const live = await liveSession(request, platform, now);
  return live && proveSession(request, live, platform, now, publicUrl);
}

/**
 * `POST /auth/logout`, a browser route outside the contract like sign-in (D48): revokes the live session the cookie
 * names, after the same Origin and CSRF proof as any cookie write, and deletes the cookie. With no live session there
 * is nothing to revoke, and the answer is the same, so signing out twice is harmless.
 */
export async function signOut(request: Request, platform: PlatformView, now: number, publicUrl: string) {
  const session = await sessionOf(request, platform, now, publicUrl);
  const value = cookieOf(request, SESSION_COOKIE);
  if (session && value !== null) await platform.revokeSession(hashToken(value), now);
  const headers = { "set-cookie": hostCookie(SESSION_COOKIE, "", 0), "cache-control": "no-store" };
  return new Response(null, { status: 204, headers });
}

/**
 * Step 6 of the verifier chain: a session cookie, on a request without an `authorization` header, is its person when
 * they are a member of the organization of the board the path names. Anyone else is told the board does not exist,
 * before any CSRF proof is asked, so a session reveals no other organization (docs/codebase.md 4.4 step 3, 5.3).
 */
export function sessionVerifier(platform: PlatformView, now: () => number, publicUrl: string): CredentialVerifier {
  return {
    name: "session",
    match: (request) => !request.headers.has("authorization") && cookieOf(request, SESSION_COOKIE) !== null,
    async verify(request, board) {
      const at = now();
      const live = await liveSession(request, platform, at);
      if (!live) return null;
      const member = await boardMember(board, live.record.person.id);
      const { id, handle, name, avatar } = (await proveSession(request, live, platform, at, publicUrl)).person;
      const principal = `ob:user:${id}`;
      const person: Principal = { actor: principal, principal, profile: null, [credentialKind]: "session" };
      return {
        ...person,
        [memberOf]: { handle, name, avatar, ...member },
        [callerCan]: personGrantCan(await board.personGrants(id), member.role),
      };
    },
  };
}
