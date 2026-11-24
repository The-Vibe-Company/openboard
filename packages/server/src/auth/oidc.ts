import { BoardError } from "@openboard/contract";
import { grants, matchesWorkload, type RepositoryPrincipal, resolveCan } from "@openboard/core";
import type { BoardGrantReads } from "@openboard/ports";
import { callerCan, credentialExpiry, credentialKind, type Deps, type Principal, workloadOf } from "../deps.ts";
import type { CredentialVerifier } from "./chain.ts";
import { bearer } from "./secrets.ts";

type Claims = Record<string, unknown>;

export interface OidcIssuer {
  /** A trusted, public HTTPS issuer selected by the server, never supplied by a token. */
  readonly url: string;
  identify(claims: Claims): { id: string; principal: RepositoryPrincipal } | null;
}

const KEY_TTL_MS = 300_000;
const FETCH_TIMEOUT_MS = 5000;
const JWT = /^[\w-]+\.[\w-]+\.[\w-]+$/;
type Fetch = NonNullable<Deps["fetch"]>;
type FetchObject = (url: URL) => Promise<Claims | null>;
const RSA = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };

function record(value: unknown): Claims | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Claims) : null;
}

function decode(value: string): Claims | null {
  return record(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
}

/** Discovery and keys stay on the preconfigured public issuer's origin. */
function oidcFetch(fetch: Fetch, schedule: Deps["schedule"]): FetchObject {
  return async (url) => {
    const abort = new AbortController();
    const deadline = Promise.withResolvers<null>();
    const cancel = schedule(FETCH_TIMEOUT_MS, () => {
      abort.abort();
      deadline.resolve(null);
    });
    const read = async () => {
      const response = await fetch(new Request(url.href, { redirect: "error", signal: abort.signal }));
      return response.ok && !response.redirected ? record(await response.json()) : null;
    };
    try {
      return await Promise.race([read(), deadline.promise]);
    } finally {
      cancel();
    }
  };
}

async function loadKeys(fetchObject: FetchObject, issuer: string): Promise<Map<string, CryptoKey>> {
  const keys = new Map<string, CryptoKey>();
  const base = new URL(issuer);
  // The built-in issuer is vetted. Exclude literal IPs and local name forms even in server configuration.
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    !/^(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]*$/i.test(base.hostname) ||
    /\.(?:localhost|local|internal|test|invalid|onion)$/i.test(base.hostname)
  )
    return keys;
  const discovery = await fetchObject(new URL(`${issuer}/.well-known/openid-configuration`));
  if (discovery?.issuer !== issuer || typeof discovery.jwks_uri !== "string") return keys;
  const jwks = URL.parse(discovery.jwks_uri);
  if (!jwks || jwks.origin !== base.origin || jwks.username || jwks.password || jwks.hash) return keys;
  const document = await fetchObject(jwks);
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

function keyCache(fetch: FetchObject, issuer: string, now: Deps["now"]) {
  let cached = new Map<string, CryptoKey>();
  let expiresAt = 0;
  let pending: Promise<void> | undefined;
  return async (kid: string) => {
    if (now() < expiresAt && cached.has(kid)) return cached.get(kid);
    pending ??= loadKeys(fetch, issuer)
      .then((keys) => {
        if (!keys.size) return;
        cached = keys;
        expiresAt = now() + KEY_TTL_MS;
      })
      .finally(() => {
        pending = undefined;
      });
    await pending;
    return now() < expiresAt ? cached.get(kid) : undefined;
  };
}

function matchesAudience(aud: unknown, expected: string): boolean {
  return aud === expected || (Array.isArray(aud) && aud.length === 1 && aud[0] === expected);
}

function issuerVerifier(issuer: string, fetch: FetchObject, now: Deps["now"]) {
  const keyFor = keyCache(fetch, issuer, now);
  return async (token: string, audience: string) => {
    try {
      const [head = "", payload = "", signature = ""] = token.split(".");
      const header = decode(head);
      const claims = decode(payload);
      if (
        header?.alg !== "RS256" ||
        typeof header.kid !== "string" ||
        header.crit !== undefined ||
        claims?.iss !== issuer ||
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

async function workloadCan(board: Pick<BoardGrantReads, "listGrants">, principal: RepositoryPrincipal) {
  const matching = (await board.listGrants()).filter(({ principals }) =>
    principals.some((grant) => matchesWorkload(grant, principal)),
  );
  return matching.length ? resolveCan(matching.map(({ can }) => grants.compileCan(can))) : null;
}

/** Resolve grant management authority again under the board's write lock. */
export async function currentWorkload(
  by: Principal,
  writer: Pick<BoardGrantReads, "listGrants">,
  now: Deps["now"],
): Promise<Principal> {
  const principal = by[workloadOf];
  if (!principal) return by;
  const can = await workloadCan(writer, principal);
  if (now() >= (by[credentialExpiry] ?? 0))
    throw new BoardError("unauthorized", "the credential expired before the grant change");
  return { ...by, [callerCan]: can ?? {} };
}

/** Verify a JWT before resolving its permissions against the request's scoped board. */
export function oidcVerifier(deps: Deps, issuer: OidcIssuer): CredentialVerifier {
  const { fetch, now } = deps;
  const check = fetch && issuerVerifier(issuer.url, oidcFetch(fetch, deps.schedule), now);
  return {
    name: "oidc",
    match: (request) => {
      const token = bearer(request);
      return token !== null && token.length <= 16_384 && JWT.test(token);
    },
    async verify(request, board, _operation, audience) {
      if (!check || !audience) return null;
      const verified = await check(bearer(request) ?? "", audience);
      if (!verified) return null;
      const { claims, expiry } = verified;
      const identity = issuer.identify(claims);
      if (!identity) return null;
      const can = await workloadCan(board, identity.principal);
      if (now() >= expiry) return null;
      if (!can) throw new BoardError("forbidden", "no grant authorizes this credential on this board");
      return {
        actor: identity.id,
        principal: identity.id,
        profile: null,
        [credentialKind]: "oidc",
        [workloadOf]: identity.principal,
        [credentialExpiry]: expiry,
        [callerCan]: can,
      };
    },
  };
}
