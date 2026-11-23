import type { Author } from "@openboard/contract";
import type { Store } from "@openboard/ports";

/** What the server is told at startup; the composition root parses it from the environment. */
export interface ServerConfig {
  readonly mode: "local" | "hosted";
  /** Local mode: who writes until credentials arrive: the local owner person, `ob:user:local-<os user>`. */
  readonly localOwner: string;
}

/** The ports the server runs on; it never sees a driver. */
export interface Ports {
  readonly store: Store;
}

export interface Logger {
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
