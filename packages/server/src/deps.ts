import type { Author } from "@openboard/contract";

/** What the server is told at startup; the composition root parses it from the environment. */
export interface ServerConfig {
  readonly mode: "local" | "hosted";
  /** Local mode: who writes until credentials arrive: the local owner person, `ob:user:local-<os user>`. */
  readonly localOwner: string;
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
}

/** Who a request writes as, once the pipeline has authenticated it. */
export type Principal = Author;
