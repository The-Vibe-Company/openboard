import type { Author, Can, Named, Role } from "@openboard/contract";

/** What the server is told at startup; the composition root parses it from the environment. */
export interface ServerConfig {
  readonly mode: "local" | "hosted";
  /** `OPENBOARD_PUBLIC_URL`: the canonical origin, no trailing slash; board URLs are built on it, never on `Host`. */
  readonly publicUrl: string;
  /** Local mode: who writes until credentials arrive: the local owner person, `ob:user:local-<os user>`. */
  readonly localOwner: string;
  /** Local mode: the SHA-256 (hex) of the owner token `ob serve` wrote to its 0600 file; absent, none is accepted. */
  readonly localOwnerTokenHash?: string;
  /** `OPENBOARD_SIGNUP`: whether a new sign-in identity makes a new person; absent, `closed` (docs/auth.md). */
  readonly signup?: "open" | "invite" | "closed";
  /** The OAuth clients of the sign-in providers this server offers, by provider ID; absent, none is offered. */
  readonly signIn?: Readonly<Record<string, OAuthClient>>;
}

/** A sign-in provider's OAuth client (docs/auth.md "Sign-in providers"); the secret is never logged. */
export interface OAuthClient {
  readonly clientId: string;
  readonly clientSecret: string;
}

/** JSON lines on standard output (docs/codebase.md 5.4); `fields` never hold a body, text, token or secret. */
export interface Logger {
  /** One line per request and per job run. */
  info(message: string, fields: Readonly<Record<string, unknown>>): void;
  /** A bug reached an edge: logged with its stack, never with a body, text or secret. */
  error(message: string, fields: Readonly<Record<string, unknown>>): void;
}

/** Time, logging and anything else that varies per process comes from here, never from a global. */
export interface Deps {
  readonly now: () => number;
  readonly log: Logger;
  /** A fresh ID for a request whose client sent none (docs/protocol.md "Request headers"). */
  readonly requestId: () => string;
  /** `length` fresh random bytes from a cryptographic source, for secrets and their IDs. */
  readonly randomBytes: (length: number) => Uint8Array;
  /** Outbound HTTP, for sign-in providers; absent, no provider is offered. */
  readonly fetch?: (request: Request) => Promise<Response>;
}

/** Who a request writes as, once the pipeline has authenticated it. */
export type Principal = Author & {
  readonly [credentialKind]?: "local" | "connection" | "agent" | "session" | "personal";
  readonly [credentialExpiry]?: number;
  readonly [connectionOf]?: ConnectionIdentity;
  /** The agent an `obt_` token was claimed as, `ag_…`. */
  readonly [agentOf]?: string;
  /**
   * The `can` the caller acts under, which every request it makes stays inside: an `obt_` token's pinned can
   * (docs/auth.md "Pinned narrowing"), an `obc_` connection's grant, a member's role-capped `*` grant (session or
   * `obp_` personal token). Only the local owner carries none, and may do everything; any other caller without one
   * may do nothing.
   */
  readonly [callerCan]?: Can;
  /** A profile's name as the caller spelled it, which is how it is shown; `profile` is its lowercase. */
  readonly [profileName]?: string;
  readonly [profileAvatar]?: string | null;
  /** The SHA-256 (hex) of the `obt_` token presented, which a refresh checks is still the agent's current one. */
  readonly [tokenHashOf]?: string;
  /** A signed-in person: who they are, and their membership of the organization the request's board belongs to. */
  readonly [memberOf]?: SessionMember;
};

/** A session's person as the board sees them, with their role and the organization and board they reach. */
export interface SessionMember {
  readonly handle: string;
  readonly name: string;
  readonly avatar: string | null;
  readonly role: Role;
  readonly org: Named;
  readonly board: Named;
}

/** A connection's secret: the connection's name, which its profiles show through, and the profiles it may use. */
export interface ConnectionIdentity {
  readonly name: string;
  readonly profiles: readonly string[];
}

/** Request-only metadata. Symbol keys stay out of serialized message authors. */
export const credentialKind = Symbol("credential kind");
export const credentialExpiry = Symbol("credential expiry");
export const connectionOf = Symbol("connection");
export const agentOf = Symbol("agent");
export const callerCan = Symbol("caller can");
export const profileName = Symbol("profile name");
export const profileAvatar = Symbol("profile avatar");
export const tokenHashOf = Symbol("token hash");
export const memberOf = Symbol("member");
