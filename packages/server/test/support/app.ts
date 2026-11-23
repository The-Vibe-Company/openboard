import { createApp, type Logger, mintLocalOwnerToken } from "../../src/index.ts";
import { openStore } from "./drivers.ts";

/** `OPENBOARD_PUBLIC_URL` of every test app. */
export const PUBLIC_URL = "http://127.0.0.1:8787";
export const BOARD_URL = `${PUBLIC_URL}/api/local/main`;
export const LOCAL_OWNER = "ob:user:local-test";
/** The fake clock every test app reads: 2023-11-14T22:13:20.000Z. */
export const NOW = 1_700_000_000_000;
/** The local owner token every test app accepts, from fixed bytes so no token-shaped string is written here. */
export const OWNER = mintLocalOwnerToken(new Uint8Array(42).fill(7));

/**
 * One app on in-memory SQLite, with a fixed clock unless one is given, a logger that keeps the errors it is told
 * unless one is given, and request IDs `req-1`, `req-2`, … in the order requests arrive.
 */
export function makeApp(options: { readonly now?: () => number; readonly log?: Logger } = {}) {
  const logged: Readonly<Record<string, unknown>>[] = [];
  const now = options.now ?? (() => NOW);
  const log: Logger = options.log ?? {
    info: () => {},
    error: (message, fields) => logged.push({ message, ...fields }),
  };
  let minted = 0;
  const app = createApp(
    { mode: "local", publicUrl: PUBLIC_URL, localOwner: LOCAL_OWNER, localOwnerTokenHash: OWNER.hash },
    { store: openStore(now) },
    { now, log, requestId: () => `req-${++minted}` },
  );
  return { ...app, logged };
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
