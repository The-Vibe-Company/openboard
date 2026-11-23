import { type Author, BoardError, type CanInput, type Connection } from "@openboard/contract";
import { isoTime } from "../ids.ts";
import { compileCan, formatGrantId, type Grant } from "./grants.ts";

/** What a new connection's write needs to know, read under the board lock. */
export interface ConnectionState {
  readonly head: number;
  /** The ID the board's next grant takes (`boards.next_grant`). */
  readonly nextGrant: number;
  /** Whether a connection of this board already has the name. */
  readonly nameTaken: boolean;
}

/** The connection as asked for, once the contract has validated it. */
export interface CreateConnectionCommand {
  readonly name: string;
  readonly can: CanInput;
  readonly direct?: boolean;
  readonly profiles?: readonly string[];
  /** How many claims the secret makes before it is spent; null or absent, no limit. */
  readonly claims?: number | null;
}

/** The minted credential: the server draws it, core never sees the secret itself. */
export interface MintedSecret {
  /** `cn_<16 base32>`, the part the secret embeds. */
  readonly id: string;
  /** SHA-256 of the secret, hex. */
  readonly hash: string;
  readonly hint: string;
}

/** The record of a connection and its grant. Holds the secret's hash, never the secret; served on no feed. */
export interface ConnectionCreated {
  readonly id: number;
  readonly type: "ob.connection.created";
  readonly at: number;
  readonly thread: null;
  readonly message: null;
  readonly channel: null;
  readonly actor: string;
  readonly principal: string;
  /** Board configuration: internal, never on `/events` (docs/data-model.md "Boards and the log"). */
  readonly visibility: 2;
  readonly payload: {
    readonly connection: Connection;
    readonly secretHash: string;
    /** How many claims the secret makes before it is spent, or null for no limit. */
    readonly claims: number | null;
    readonly grant: Grant;
    readonly by: Author;
  };
}

/** A connection's principal: `ob:conn:cn_…` (docs/auth.md "Connections"). */
export function connectionPrincipal(id: string): string {
  return `ob:conn:${id}`;
}

/**
 * A new connection holding one grant whose only principal is the connection itself. A name already used on the
 * board is 409 `slug_taken`; the grant's `can` is compiled (`grants.compileCan`). A direct connection takes no
 * `claims`: its secret is a bearer on every route, which counting claims could never spend (400 `invalid_request`).
 */
export function decideCreate(
  state: ConnectionState,
  command: CreateConnectionCommand,
  { by, now, secret }: { readonly by: Author; readonly now: number; readonly secret: MintedSecret },
): { connection: Connection; events: [ConnectionCreated] } {
  if (state.nameTaken) {
    throw new BoardError("slug_taken", `a connection named ${command.name} already exists on this board`, {
      hint: "Pick another name, or use the connection that has it.",
    });
  }
  if (command.direct && command.claims != null) {
    throw new BoardError("invalid_request", "a direct connection's secret is a bearer, so its claims cannot spend it", {
      hint: "Leave out direct to make a single-use secret: it then only claims agent tokens.",
    });
  }
  const grant: Grant = {
    id: state.nextGrant,
    principals: [{ kind: "connection", connection: secret.id }],
    can: compileCan(command.can),
  };
  const connection: Connection = {
    id: secret.id,
    principal: connectionPrincipal(secret.id),
    name: command.name,
    grant: formatGrantId(grant.id),
    can: grant.can,
    direct: command.direct ?? false,
    profiles: [...(command.profiles ?? ["*"])],
    secretHint: secret.hint,
    createdBy: by.actor,
    createdAt: isoTime(now),
  };
  const event: ConnectionCreated = {
    id: state.head + 1,
    type: "ob.connection.created",
    at: now,
    thread: null,
    message: null,
    channel: null,
    actor: by.actor,
    principal: by.principal,
    visibility: 2,
    payload: { connection, secretHash: secret.hash, claims: command.claims ?? null, grant, by },
  };
  return { connection, events: [event] };
}

/**
 * Whether a connection whose `profiles` are `patterns` may write as `name`: `*` lets any in, `fixer-*` any name that
 * starts with `fixer-`, and a plain pattern only that name; names compare case-insensitively.
 */
export function profileAllowed(patterns: readonly string[], name: string): boolean {
  const wanted = name.toLowerCase();
  return patterns.some((pattern) => {
    const lower = pattern.toLowerCase();
    return lower.endsWith("*") ? wanted.startsWith(lower.slice(0, -1)) : wanted === lower;
  });
}
