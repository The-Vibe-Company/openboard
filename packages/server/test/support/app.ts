import { createApp } from "../../src/index.ts";
import { openStore } from "./drivers.ts";

export const BOARD_URL = "http://127.0.0.1:8787/api/local/main";
export const LOCAL_OWNER = "ob:user:local-test";
/** The fake clock every test app reads: 2023-11-14T22:13:20.000Z. */
export const NOW = 1_700_000_000_000;

/** One app on in-memory SQLite, with a fixed clock and a logger that keeps what it is told. */
export function makeApp() {
  const logged: Readonly<Record<string, unknown>>[] = [];
  const now = () => NOW;
  const app = createApp(
    { mode: "local", localOwner: LOCAL_OWNER },
    { store: openStore(now) },
    { now, log: { error: (message, fields) => logged.push({ message, ...fields }) } },
  );
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
