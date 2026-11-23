import { createApp, type Logger } from "../../src/index.ts";
import { openStore } from "./drivers.ts";

export const BOARD_URL = "http://127.0.0.1:8787/api/local/main";
export const LOCAL_OWNER = "ob:user:local-test";
/** The fake clock every test app reads: 2023-11-14T22:13:20.000Z. */
export const NOW = 1_700_000_000_000;

/**
 * One app on in-memory SQLite, with a fixed clock unless one is given, and a logger that keeps the errors it is told
 * unless one is given.
 */
export function makeApp(options: { readonly now?: () => number; readonly log?: Logger } = {}) {
  const logged: Readonly<Record<string, unknown>>[] = [];
  const now = options.now ?? (() => NOW);
  const log: Logger = options.log ?? {
    info: () => {},
    error: (message, fields) => logged.push({ message, ...fields }),
  };
  const app = createApp({ mode: "local", localOwner: LOCAL_OWNER }, { store: openStore(now) }, { now, log });
  return { ...app, logged };
}

/** Sends one request to `app`, relative to the local board's URL. */
export function call(
  app: { fetch(request: Request): Promise<Response> },
  method: string,
  path: string,
  body?: unknown,
) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  }
  return app.fetch(new Request(`${BOARD_URL}${path}`, init));
}
