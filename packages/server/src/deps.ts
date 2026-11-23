import type { Author } from "@openboard/contract";

/** What the server is told at startup; the composition root parses it from the environment. */
export interface ServerConfig {
  readonly mode: "local" | "hosted";
  /** `OPENBOARD_PUBLIC_URL`: the canonical origin, no trailing slash; board URLs are built on it, never on `Host`. */
  readonly publicUrl: string;
  /** Local mode: who writes until credentials arrive: the local owner person, `ob:user:local-<os user>`. */
  readonly localOwner: string;
  /** Local mode: the SHA-256 (hex) of the owner token `ob serve` wrote to its 0600 file; absent, none is accepted. */
  readonly localOwnerTokenHash?: string;
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
}

/** Who a request writes as, once the pipeline has authenticated it. */
export type Principal = Author & {
  readonly [credentialKind]?: "local" | "connection";
  readonly [connectionOf]?: ConnectionIdentity;
};

/** A connection's secret: the connection's name, which its profiles show through, and the profiles it may use. */
export interface ConnectionIdentity {
  readonly name: string;
  readonly profiles: readonly string[];
}

/** Request-only metadata. Symbol keys stay out of serialized message authors. */
export const credentialKind = Symbol("credential kind");
export const connectionOf = Symbol("connection");
