import {
  type Author,
  BoardError,
  type Can,
  type CanInput,
  type ClaimedAgent,
  type Permission,
} from "@openboard/contract";
import { isoTime } from "../ids.ts";
import { connectionPrincipal, profileAllowed } from "./connections.ts";
import { compileRequiredCan, withImplied } from "./grants.ts";

/** The connection whose secret claims, as stored: its patterns, its grant, and its token lifetimes in seconds. */
export interface ClaimingConnection {
  readonly id: string;
  readonly profiles: readonly string[];
  readonly can: Can;
  /** A token's lifetime when the claim names none. */
  readonly tokenTtl: number;
  /** How long after the claim every token of the agent stops working, refreshed or not. */
  readonly tokenMax: number;
  /** How many claims its secret makes before it is spent (null: no limit), and how many it made, read under the lock. */
  readonly claims: { readonly max: number | null; readonly used: number };
}

/** The unrevoked agent of the connection holding the claimed profile, whose token expires last, read under the lock. */
export interface ProfileHolder {
  readonly id: string;
  /** Epoch milliseconds of its `expiresAt`: it holds the profile until then. */
  readonly tokenExpires: number;
}

/** The claim as asked for, once the contract has validated it. */
export interface ClaimCommand {
  readonly profile: string;
  readonly can?: CanInput;
  readonly ttl?: string;
  readonly idempotencyKey?: string;
}

/** The minted agent token: the server draws it, core never sees the token itself. */
export interface MintedToken {
  /** `ag_<16 base32>`, the part the token embeds. */
  readonly id: string;
  /** SHA-256 of the token, hex. */
  readonly hash: string;
}

/** The record of a claimed agent. Holds the token's hash, never the token; served on no feed. */
export interface AgentClaimed {
  readonly id: number;
  readonly type: "ob.agent.claimed";
  readonly at: number;
  readonly thread: null;
  readonly message: null;
  readonly channel: null;
  readonly actor: string;
  readonly principal: string;
  /** Board configuration: internal, never on `/events` (docs/data-model.md "Boards and the log"). */
  readonly visibility: 2;
  readonly payload: {
    readonly agent: ClaimedAgent;
    readonly connection: string;
    /** The profile as the claim spelled it, which is how it is shown; the actor holds its lowercase. */
    readonly profile: string;
    readonly claimKey?: string;
    readonly tokenHash: string;
    /** Epoch milliseconds of `agent.expiresAt` and `agent.hardExpiresAt`. */
    readonly tokenExpires: number;
    readonly hardExpires: number;
    readonly by: Author;
  };
}

const UNIT_S: Readonly<Record<string, number>> = Object.freeze({ s: 1, m: 60, h: 3600, d: 86_400 });

/** Seconds in a lifetime written `<n><s|m|h|d>`; anything else is 400 `invalid_request`. */
export function ttlSeconds(ttl: string): number {
  const match = /^([1-9][0-9]{0,6})([smhd])$/.exec(ttl);
  const unit = UNIT_S[match?.[2] ?? ""];
  if (!match || unit === undefined) {
    throw new BoardError("invalid_request", `ttl ${JSON.stringify(ttl)} is not a lifetime`, {
      hint: "Write ttl as a number and a unit: `90s`, `5m`, `1h`, `1d`.",
    });
  }
  return Number(match[1]) * unit;
}

/** Whether `outer` lets in all `inner` names: `*` everything, `dev/` `dev` and what is under it, `dev` only `dev`. */
function covers(outer: string, inner: string): boolean {
  if (outer === "*") return true;
  if (!outer.endsWith("/")) return inner === outer;
  return inner === outer.slice(0, -1) || inner.startsWith(outer);
}

/** Upstream's order of specificity: an exact channel, then the longest prefix, then `*`. */
function specificity(pattern: string): number {
  if (pattern === "*") return 0;
  return pattern.endsWith("/") ? pattern.length : Number.MAX_SAFE_INTEGER;
}

/** What `can` lets in at `spot`, implications included, by its most specific pattern covering it; nothing when none does. */
export function allowedAt(can: Can, spot: string): readonly Permission[] {
  const deciding = Object.keys(can)
    .filter((pattern) => covers(pattern, spot))
    .sort((a, b) => specificity(b) - specificity(a))[0];
  return deciding === undefined ? [] : withImplied(can[deciding] ?? []);
}

/**
 * The claim's `can`, compiled, when the connection's grant lets in all of it; a claim narrows, never widens, so a
 * permission past the grant is 403 `forbidden`. Every pattern either side names is checked: between them, which
 * pattern decides a channel cannot change.
 */
function narrowed(grant: Can, written: CanInput): Can {
  const can = compileRequiredCan(written);
  for (const spot of new Set([...Object.keys(grant), ...Object.keys(can)])) {
    const allowed = allowedAt(grant, spot);
    const missing = allowedAt(can, spot).find((permission) => !allowed.includes(permission));
    if (missing !== undefined) {
      throw new BoardError("forbidden", `the connection's grant does not let ${missing} in at ${spot}`, {
        hint: "Claim a can inside the connection's grant, or leave can out to take the whole grant.",
      });
    }
  }
  return can;
}

/**
 * An agent of `connection` pinned to `command.profile`, which the connection's `profiles` patterns must let in (else
 * 403 `forbidden`). Its `can` is the claim's, inside the connection's grant, or that grant; its token lives `ttl` (default the
 * connection's token lifetime), never past the connection's cap, which is also its hard expiry. A secret that made its
 * last claim is spent: 410 `secret_spent` (docs/auth.md mode 2, "Single-use secrets"). A profile a live agent of the
 * connection holds, one whose token has not expired, is 409 `profile_taken` ("Profile collisions").
 */
export function decideClaim(
  state: { readonly head: number; readonly holder: ProfileHolder | null },
  command: ClaimCommand,
  context: {
    readonly by: Author;
    readonly now: number;
    readonly connection: ClaimingConnection;
    readonly token: MintedToken;
  },
): { agent: ClaimedAgent; events: [AgentClaimed] } {
  const { by, now, connection, token } = context;
  const { max, used } = connection.claims;
  if (max !== null && used >= max) {
    throw new BoardError("secret_spent", "this connection's secret has made all its claims", {
      hint: "Ask the board's owner for a new connection; a claimed agent token keeps working until it expires.",
    });
  }
  if (!profileAllowed(connection.profiles, command.profile)) {
    throw new BoardError("forbidden", `this connection may not claim ${command.profile}`, {
      hint: `Pick a profile its patterns let in: ${connection.profiles.join(", ")}.`,
    });
  }
  if (state.holder !== null && now < state.holder.tokenExpires) {
    throw new BoardError("profile_taken", `a live agent of this connection holds ${command.profile}`, {
      hint: "Claim another profile, or wait until the agent holding it expires.",
    });
  }
  const ttl = Math.min(command.ttl === undefined ? connection.tokenTtl : ttlSeconds(command.ttl), connection.tokenMax);
  const tokenExpires = now + ttl * 1000;
  const hardExpires = now + connection.tokenMax * 1000;
  const agent: ClaimedAgent = {
    id: token.id,
    actor: `${connectionPrincipal(connection.id)}+${command.profile.toLowerCase()}`,
    can: command.can === undefined ? connection.can : narrowed(connection.can, command.can),
    expiresAt: isoTime(tokenExpires),
    hardExpiresAt: isoTime(hardExpires),
  };
  const event: AgentClaimed = {
    id: state.head + 1,
    type: "ob.agent.claimed",
    at: now,
    thread: null,
    message: null,
    channel: null,
    actor: by.actor,
    principal: by.principal,
    visibility: 2,
    payload: {
      agent,
      connection: connection.id,
      profile: command.profile,
      ...(command.idempotencyKey === undefined ? {} : { claimKey: command.idempotencyKey }),
      tokenHash: token.hash,
      tokenExpires,
      hardExpires,
      by: { actor: by.actor, principal: by.principal, profile: by.profile },
    },
  };
  return { agent, events: [event] };
}

/** How long a refreshed token's predecessor keeps working (docs/auth.md mode 2, "Refresh"). */
export const PREVIOUS_TOKEN_MS = 60_000;

/** The agent as stored when its token is refreshed: the current token's hash and its lifetimes. */
export interface RefreshingAgent {
  readonly agent: ClaimedAgent;
  /** SHA-256 of the agent's current token, hex. */
  readonly tokenHash: string;
  /** Epoch milliseconds of `agent.expiresAt` and `agent.hardExpiresAt`. */
  readonly tokenExpires: number;
  readonly hardExpires: number;
  /** The connection's token lifetime, in seconds. */
  readonly tokenTtl: number;
}

/** The rotation of an agent's token: the new token's hash, its predecessor's, and when the predecessor stops. */
export interface AgentRefreshed {
  readonly id: number;
  readonly type: "ob.agent.refreshed";
  readonly at: number;
  readonly thread: null;
  readonly message: null;
  readonly channel: null;
  readonly actor: string;
  readonly principal: string;
  readonly visibility: 2;
  readonly payload: {
    readonly agent: string;
    readonly tokenHash: string;
    readonly previousHash: string;
    /** Epoch milliseconds: the predecessor works until then, the new token until `tokenExpires`. */
    readonly previousUntil: number;
    readonly tokenExpires: number;
    readonly by: Author;
  };
}

/**
 * A new token for `state.agent`, with the same pins, living the connection's token lifetime from `now`, never less
 * than the token it replaces (a claim may ask for a longer one) and never past the agent's hard expiry; the token it replaces keeps working `PREVIOUS_TOKEN_MS`. Only the current token refreshes
 * (`presented` is its hash): its predecessor, or a token another refresh already replaced, is 401 `unauthorized`. Past
 * the token's expiry, decided here under the lock so a claim that took the profile meanwhile stands (D50), or the hard
 * expiry, nothing refreshes: the connection's secret claims a new agent.
 */
export function decideRefresh(
  state: { readonly head: number; readonly agent: RefreshingAgent },
  context: {
    readonly by: Author;
    readonly now: number;
    readonly presented: string;
    readonly token: MintedToken;
    readonly preserveExpiry?: boolean;
  },
): { agent: ClaimedAgent; events: [AgentRefreshed] } {
  const { by, now, presented, token } = context;
  const { agent, tokenHash, tokenTtl, tokenExpires: currentExpires, hardExpires } = state.agent;
  if (presented !== tokenHash) {
    throw new BoardError("unauthorized", "this token was already refreshed", {
      hint: "Use the token the refresh answered.",
    });
  }
  if (now >= hardExpires) {
    throw new BoardError("unauthorized", "this agent's tokens reached their hard expiry", {
      hint: "Claim a new token with the connection's secret: `ob connect <BOARD_URL> --as <profile>`.",
    });
  }
  if (now >= currentExpires) {
    throw new BoardError("unauthorized", "this token expired", {
      hint: "Claim a new token with the connection's secret: `ob connect <BOARD_URL> --as <profile>`.",
    });
  }
  const tokenExpires = context.preserveExpiry
    ? currentExpires
    : Math.min(Math.max(now + tokenTtl * 1000, currentExpires), hardExpires);
  const refreshed: ClaimedAgent = { ...agent, expiresAt: isoTime(tokenExpires) };
  const event: AgentRefreshed = {
    id: state.head + 1,
    type: "ob.agent.refreshed",
    at: now,
    thread: null,
    message: null,
    channel: null,
    actor: by.actor,
    principal: by.principal,
    visibility: 2,
    payload: {
      agent: agent.id,
      tokenHash: token.hash,
      previousHash: tokenHash,
      previousUntil: context.preserveExpiry
        ? Math.min(now + PREVIOUS_TOKEN_MS, currentExpires)
        : now + PREVIOUS_TOKEN_MS,
      tokenExpires,
      by: { actor: by.actor, principal: by.principal, profile: by.profile },
    },
  };
  return { agent: refreshed, events: [event] };
}
