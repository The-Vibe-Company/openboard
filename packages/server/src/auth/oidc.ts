import { BoardError, type GrantView } from "@openboard/contract";
import { type OidcPrincipal, type RepositoryPrincipal, resolveRankedCan, subjectGrants } from "@openboard/core";
import type { BoardGrantReads, PlatformView } from "@openboard/ports";
import { callerCan, credentialExpiry, credentialKind, type Deps, type Principal, workloadOf } from "../deps.ts";
import { publicHttps, resolvePublicAddresses } from "../public-host.ts";
import type { CredentialVerifier } from "./chain.ts";
import { bearer } from "./secrets.ts";

type Workload = RepositoryPrincipal | OidcPrincipal;
type Claims = Record<string, unknown>;

export interface OidcIssuer {
  /** A trusted, public HTTPS issuer selected by the server, never supplied by a token. */
  readonly url: string;
  identify(claims: Claims): { id: string; principal: RepositoryPrincipal } | null;
}

const KEY_TTL_MS = 300_000;
const RELOAD_INTERVAL_MS = 30_000;
const MAX_RESPONSE_BYTES = 65_536;
const FETCH_TIMEOUT_MS = 5000;
const JWT = /^[\w-]+\.[\w-]+\.[\w-]+$/;
type FetchObject = (url: URL) => Promise<Claims | null>;
const RSA = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };

function record(value: unknown): Claims | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Claims) : null;
}

function decode(value: string): Claims | null {
  try {
    return record(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
  } catch {
    return null;
  }
}

async function responseObject(response: Response): Promise<Claims | null> {
  const body = response.body;
  if (!body) return null;
  if (!response.ok || response.redirected || Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
    void body.cancel().catch(() => {});
    return null;
  }
  const reader = body.getReader();
  const buffer = new Uint8Array(MAX_RESPONSE_BYTES);
  let offset = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return record(JSON.parse(new TextDecoder().decode(buffer.subarray(0, offset))));
    if (offset + value.length > buffer.length) {
      void reader.cancel().catch(() => {});
      return null;
    }
    buffer.set(value, offset);
    offset += value.length;
  }
}

async function fetchPinned(
  url: URL,
  addresses: readonly string[],
  signal: AbortSignal,
  fetch: NonNullable<Deps["webhookFetch"]>,
): Promise<Response | null> {
  const endpoint = new URL(url);
  for (const address of addresses) {
    signal.throwIfAborted();
    endpoint.hostname = address.includes(":") ? `[${address}]` : address;
    const request = new Request(endpoint.href, {
      headers: { host: url.host, "accept-encoding": "identity" },
      redirect: "manual",
      signal,
    });
    try {
      return await fetch(request, {
        proxy: false,
        redirect: "manual",
        keepalive: false,
        decompress: false,
        tls: { serverName: url.hostname, rejectUnauthorized: true },
      });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ECONNREFUSED")) throw error;
    }
  }
  return null;
}

function oidcFetch({ fetch, webhookFetch, schedule }: Deps, resolve: NonNullable<Deps["resolveHost"]>): FetchObject {
  return async (url) => {
    const abort = new AbortController();
    const deadline = Promise.withResolvers<null>();
    const cancel = schedule(FETCH_TIMEOUT_MS, () => {
      abort.abort();
      deadline.resolve(null);
    });
    const read = async () => {
      const addresses = await resolvePublicAddresses(url, resolve);
      if (!addresses || abort.signal.aborted) return null;
      const response = webhookFetch
        ? await fetchPinned(url, addresses, abort.signal, webhookFetch)
        : await fetch?.(new Request(url.href, { redirect: "error", signal: abort.signal }));
      return response ? responseObject(response) : null;
    };
    const inflight = read();
    inflight.catch(() => {});
    try {
      return await Promise.race([inflight, deadline.promise]);
    } catch {
      // Unavailable or malformed issuer responses cannot authenticate a token.
      return null;
    } finally {
      cancel();
    }
  };
}

async function loadDocument(fetchObject: FetchObject, issuer: string): Promise<Claims | null> {
  const base = URL.parse(issuer);
  if (!base || !publicHttps(base) || base.search || base.hash) return null;
  const discoveryUrl = new URL(base);
  discoveryUrl.pathname = `${base.pathname.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const discovery = await fetchObject(discoveryUrl);
  if (discovery?.issuer !== issuer || typeof discovery.jwks_uri !== "string") return null;
  const jwks = URL.parse(discovery.jwks_uri);
  if (!jwks || jwks.origin !== base.origin || jwks.username || jwks.password || jwks.hash) return null;
  return fetchObject(jwks);
}

async function importKeys(document: Claims | null): Promise<Map<string, CryptoKey>> {
  const keys = new Map<string, CryptoKey>();
  if (!Array.isArray(document?.keys)) return keys;
  for (const entry of document.keys as unknown[]) {
    const key = record(entry);
    if (
      key?.kty !== "RSA" ||
      typeof key.kid !== "string" ||
      (key.alg !== undefined && key.alg !== "RS256") ||
      (key.use !== undefined && key.use !== "sig")
    )
      continue;
    if (keys.has(key.kid)) return new Map();
    try {
      keys.set(key.kid, await crypto.subtle.importKey("jwk", key, RSA, false, ["verify"]));
    } catch {
      // Other keys in a mixed set can still be valid signature keys.
    }
  }
  return keys;
}

type KeyStore = Pick<PlatformView, "reserveOidcReload" | "readOidcKeys" | "finishOidcReload">;

function keyCache(fetch: FetchObject, issuer: string, now: Deps["now"], store: KeyStore) {
  let cached = new Map<string, CryptoKey>();
  let expiresAt = 0;
  let pending: Promise<void> | undefined;
  let nextRead = 0;
  async function refresh() {
    const stored = await store.readOidcKeys(issuer, now());
    if (stored && stored.expiresAt > expiresAt) {
      cached = await importKeys(record(JSON.parse(stored.document)));
      expiresAt = stored.expiresAt;
      return;
    }
    const started = now();
    // Hold the lease through both fetch deadlines, then start cooldown when loading finishes.
    const leaseUntil = started + RELOAD_INTERVAL_MS + 2 * FETCH_TIMEOUT_MS;
    if (!(await store.reserveOidcReload(issuer, started, leaseUntil))) return;
    let loaded: { document: string; expiresAt: number } | null = null;
    try {
      const document = await loadDocument(fetch, issuer);
      const keys = await importKeys(document);
      if (!keys.size) return;
      loaded = { document: JSON.stringify(document), expiresAt: now() + KEY_TTL_MS };
      cached = keys;
      expiresAt = loaded.expiresAt;
    } finally {
      const completedAt = now();
      nextRead = completedAt + RELOAD_INTERVAL_MS;
      await store.finishOidcReload(issuer, leaseUntil, completedAt, nextRead, loaded);
    }
  }
  return {
    expired: () => !pending && now() >= Math.max(expiresAt, nextRead),
    async keyFor(kid: string) {
      if (now() < expiresAt && cached.has(kid)) return cached.get(kid);
      if (!pending && now() >= nextRead) {
        pending = refresh().finally(() => {
          pending = undefined;
        });
      }
      await pending;
      return now() < expiresAt ? cached.get(kid) : undefined;
    },
  };
}

function matchesAudience(aud: unknown, expected: string): boolean {
  return aud === expected || (Array.isArray(aud) && aud.length === 1 && aud[0] === expected);
}

function issuerVerifier(now: Deps["now"]) {
  return async (token: string, audience: string, claims: Claims, keyFor: ReturnType<typeof keyCache>["keyFor"]) => {
    const [head = "", payload = "", signature = ""] = token.split(".");
    const header = decode(head);
    if (
      header?.alg !== "RS256" ||
      typeof header.kid !== "string" ||
      header.crit !== undefined ||
      !matchesAudience(claims.aud, audience) ||
      typeof claims.exp !== "number" ||
      !Number.isFinite(claims.exp) ||
      (claims.nbf !== undefined && (typeof claims.nbf !== "number" || !Number.isFinite(claims.nbf)))
    )
      return null;
    const expiry = claims.exp * 1000;
    const active = () =>
      Number.isFinite(expiry) && now() < expiry && (typeof claims.nbf !== "number" || now() >= claims.nbf * 1000);
    if (!active()) return null;
    const key = await keyFor(header.kid);
    if (!key) return null;
    try {
      const signed = await crypto.subtle.verify(
        RSA,
        key,
        Buffer.from(signature, "base64url"),
        Buffer.from(`${head}.${payload}`),
      );
      return signed && active() ? { claims, expiry } : null;
    } catch {
      return null;
    }
  };
}

export function workloadCan(grantViews: readonly GrantView[], principal: Workload) {
  const matching = subjectGrants(grantViews, principal);
  return matching.some(({ level }) => level === "principal") ? resolveRankedCan(matching) : null;
}

/** Resolve grant management authority again under the board's write lock. */
export async function currentWorkload(
  by: Principal,
  writer: Pick<BoardGrantReads, "listGrants">,
  now: Deps["now"],
): Promise<Principal> {
  const principal = by[workloadOf];
  if (!principal) return by;
  const can = workloadCan(await writer.listGrants(), principal);
  if (now() >= (by[credentialExpiry] ?? 0))
    throw new BoardError("unauthorized", "the credential expired before the grant change");
  return { ...by, [callerCan]: can ?? {} };
}

function oidcIdentity(issuer: string, claims: Claims): { id: string; principal: OidcPrincipal } | null {
  if (typeof claims.sub !== "string" || !claims.sub) return null;
  // Preserve the separator even when an issuer path or explicit port contains a colon.
  const escapeActorPart = (part: string) => part.replaceAll("%", "%25").replaceAll("+", "%2B");
  const label = escapeActorPart(issuer.slice("https:".length)).replaceAll(":", "%3A");
  return { id: `oidc:https:${label}:${escapeActorPart(claims.sub)}`, principal: { kind: "oidc", issuer, claims } };
}

/** Verify a JWT before resolving its permissions against the request's scoped board. */
export function oidcVerifier(deps: Deps, issuer: OidcIssuer, store: KeyStore): CredentialVerifier {
  const { fetch, webhookFetch, now, resolveHost } = deps;
  const outbound = (fetch || webhookFetch) && resolveHost && oidcFetch(deps, resolveHost);
  const check = issuerVerifier(now);
  const caches = new Map<string, ReturnType<typeof keyCache>>();
  function cacheFor(url: string, fetchObject: FetchObject) {
    let cache = caches.get(url);
    if (cache) return cache;
    for (const [name, entry] of caches) {
      if (entry.expired()) caches.delete(name);
    }
    cache = keyCache(fetchObject, url, now, store);
    caches.set(url, cache);
    return cache;
  }
  return {
    name: "oidc",
    match: (request) => {
      const token = bearer(request);
      return token !== null && token.length <= 16_384 && JWT.test(token);
    },
    async verify(request, board, _operation, audience) {
      if (!outbound || !audience) return null;
      const token = bearer(request) ?? "";
      const claims = decode(token.split(".")[1] ?? "");
      const url = claims?.iss;
      if (!claims || typeof url !== "string") return null;
      const builtIn = url === issuer.url;
      if (
        !builtIn &&
        !(await board.listGrants()).some(({ principals }) =>
          principals.some((grant) => grant.kind === "oidc" && grant.issuer === url),
        )
      )
        return null;
      const verified = await check(token, audience, claims, cacheFor(url, outbound).keyFor);
      if (!verified) return null;
      const { expiry } = verified;
      const repository = builtIn ? issuer.identify(claims) : null;
      const generic = oidcIdentity(url, claims);
      if (!repository && !generic) return null;
      const currentGrants = await board.listGrants();
      if (now() >= expiry) return null;
      for (const identity of [repository, generic]) {
        if (!identity) continue;
        const can = workloadCan(currentGrants, identity.principal);
        if (can)
          return {
            actor: identity.id,
            principal: identity.id,
            profile: null,
            [credentialKind]: "oidc",
            [workloadOf]: identity.principal,
            [credentialExpiry]: expiry,
            [callerCan]: can,
          };
      }
      if (builtIn && !repository) return null;
      throw new BoardError("forbidden", "no grant authorizes this credential on this board");
    },
  };
}
