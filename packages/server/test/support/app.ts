import type { Jobs } from "@openboard/ports";
import { type Deps, type Logger, mintLocalOwnerToken, type ServerConfig } from "../../src/index.ts";
import { createCluster } from "./cluster.ts";
import { openStore, type TestStore } from "./drivers.ts";

/** `OPENBOARD_PUBLIC_URL` of every test app. */
export const PUBLIC_URL = "http://127.0.0.1:8787";
export const BOARD_URL = `${PUBLIC_URL}/api/local/main`;
export const LOCAL_OWNER = "ob:user:local-test";
/** The fake clock every test app reads: 2023-11-14T22:13:20.000Z. */
export const NOW = 1_700_000_000_000;
/** The local owner token every test app accepts, from fixed bytes so no token-shaped string is written here. */
export const OWNER = mintLocalOwnerToken(new Uint8Array(42).fill(7));

/** Tests that do not exercise timers fail if they accidentally arm one. */
export function unexpectedTimer(): never {
  throw new Error("unexpected timer");
}

type AppOptions = Pick<ServerConfig, "signup" | "signIn" | "webDir" | "secretKey" | "webhookTargets"> &
  Pick<Deps, "fetch" | "resolveHost" | "webhookFetch"> & {
    readonly mode?: ServerConfig["mode"];
    readonly publicUrl?: ServerConfig["publicUrl"];
    readonly now?: () => number;
    readonly log?: Logger;
    readonly schedule?: Deps["schedule"];
    readonly store?: TestStore;
    readonly watchJobs?: Jobs["watch"];
  };

/**
 * The app a test runs on (`createCluster`): one app on in-memory SQLite, or with `OPENBOARD_TEST_DRIVER=postgres` two
 * instances on one fresh Postgres database whose `fetch` alternates between them. Its instances share
 * a fixed clock unless one is given, a logger that keeps the errors it is told unless one is given, request IDs
 * `req-1`, `req-2`, … in the order requests arrive, and random bytes all 1, then all 2, ….
 */
export function makeApp(options: AppOptions = {}) {
  const { mode = "local", signup, signIn, fetch } = options;
  const logged: Readonly<Record<string, unknown>>[] = [];
  const now = options.now ?? (() => NOW);
  const log: Logger = options.log ?? {
    info: () => {},
    error: (message, fields) => logged.push({ message, ...fields }),
  };
  let minted = 0;
  let drawn = 0;
  const config: ServerConfig = {
    mode,
    publicUrl: options.publicUrl ?? PUBLIC_URL,
    localOwner: LOCAL_OWNER,
    // Keep a configured hash in hosted tests to exercise the verifier's mode guard.
    localOwnerTokenHash: OWNER.hash,
    ...(options.webhookTargets && { webhookTargets: options.webhookTargets }),
    ...(options.secretKey && { secretKey: options.secretKey }),
    ...(signup && { signup }),
    ...(options.webDir === undefined ? {} : { webDir: options.webDir }),
    ...(signIn && { signIn }),
  };
  const deps: Deps = {
    now,
    log,
    requestId: () => `req-${++minted}`,
    schedule: options.schedule ?? unexpectedTimer,
    randomBytes: (length) => new Uint8Array(length).fill(++drawn),
    ...(fetch && { fetch }),
    ...(options.webhookFetch && { webhookFetch: options.webhookFetch }),
    ...(options.resolveHost && { resolveHost: options.resolveHost }),
  };
  const app = createCluster(config, { store: options.store ?? openStore(now), watchJobs: options.watchJobs }, deps);
  return Object.assign(app, { logged });
}

/** Sends one request to `app` as the local owner, relative to the local board's URL. */
export function call(
  app: { fetch(request: Request): Promise<Response> },
  method: string,
  path: string,
  body?: unknown,
) {
  const headers: Record<string, string> = { authorization: `Bearer ${OWNER.token}` };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    headers["content-type"] = "application/json";
  }
  return app.fetch(new Request(`${BOARD_URL}${path}`, init));
}
