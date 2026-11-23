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
import { compileCan } from "./grants.ts";

/** The connection whose secret claims, as stored: its patterns, its grant, and its token lifetimes in seconds. */
export interface ClaimingConnection {
  readonly id: string;
  readonly profiles: readonly string[];
  readonly can: Can;
  /** A token's lifetime when the claim names none. */
  readonly tokenTtl: number;
  /** How long after the claim every token of the agent stops working, refreshed or not. */
  readonly tokenMax: number;
}

/** The claim as asked for, once the contract has validated it. */
export interface ClaimCommand {
  readonly profile: string;
  readonly can?: CanInput;
  readonly ttl?: string;
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

/** What `can` lets in at `spot`, by its most specific pattern covering it; nothing when none does. */
function allowedAt(can: Can, spot: string): readonly Permission[] {
  const deciding = Object.keys(can)
    .filter((pattern) => covers(pattern, spot))
    .sort((a, b) => specificity(b) - specificity(a))[0];
  return deciding === undefined ? [] : (can[deciding] ?? []);
}

/**
 * The claim's `can`, compiled, when the connection's grant lets in all of it; a claim narrows, never widens, so a
 * permission past the grant is 403 `forbidden`. Every pattern either side names is checked: between them, which
 * pattern decides a channel cannot change.
 */
function narrowed(grant: Can, written: CanInput): Can {
  const can = compileCan(written);
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
 * connection's token lifetime), never past the connection's cap, which is also its hard expiry.
 */
export function decideClaim(
  state: { readonly head: number },
  command: ClaimCommand,
  context: {
    readonly by: Author;
    readonly now: number;
    readonly connection: ClaimingConnection;
    readonly token: MintedToken;
  },
): { agent: ClaimedAgent; events: [AgentClaimed] } {
  const { by, now, connection, token } = context;
  if (!profileAllowed(connection.profiles, command.profile)) {
    throw new BoardError("forbidden", `this connection may not claim ${command.profile}`, {
      hint: `Pick a profile its patterns let in: ${connection.profiles.join(", ")}.`,
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
      tokenHash: token.hash,
      tokenExpires,
      hardExpires,
      by: { actor: by.actor, principal: by.principal, profile: by.profile },
    },
  };
  return { agent, events: [event] };
}
