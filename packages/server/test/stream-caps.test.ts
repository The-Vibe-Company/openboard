import { expect, test } from "bun:test";
import type { createConnection, OutputOf } from "@openboard/contract";
import { BOARD_URL, call, makeApp, OWNER } from "./support/app.ts";
import { STREAM_MAX_MS } from "../src/live/sse.ts";

function subscribe(
  app: { fetch(request: Request): Promise<Response> },
  token = OWNER.token,
  options?: {
    profile?: string;
    signal?: AbortSignal;
    query?: string;
  },
) {
  const headers = { accept: "text/event-stream", authorization: `Bearer ${token}` };
  return app.fetch(
    new Request(`${BOARD_URL}/events${options?.query ?? ""}`, {
      headers: options?.profile ? { ...headers, "x-board-profile": options.profile } : headers,
      signal: options?.signal,
    }),
  );
}

async function createReader(app: Parameters<typeof call>[0], name: string): Promise<string> {
  const response = await call(app, "POST", "/x/connections", { name, direct: true, can: { "*": ["read"] } });
  expect(response.status).toBe(201);
  return ((await response.json()) as OutputOf<typeof createConnection>).secret;
}

function opened(response: Response): ReadableStream<Uint8Array> {
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/event-stream");
  return response.body!;
}

async function refused(response: Response) {
  expect(response.status).toBe(429);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(response.headers.get("retry-after")).toBe("1");
  expect(await response.json()).toMatchObject({ error: { code: "rate_limited" } });
}

test("caps the principal across profiles and frees slots after cancellation, abort, deadline or setup failure", async () => {
  const deadlines = new Set<() => void>();
  const cluster = makeApp({
    schedule(delay, run) {
      if (delay === STREAM_MAX_MS) deadlines.add(run);
      return () => deadlines.delete(run);
    },
  });
  try {
    const [app, sibling] = cluster.instances;
    const other = await createReader(app!, "other-reader");
    const first = opened(await subscribe(app!));
    const expire = [...deadlines][0]!;
    const abort = new AbortController();
    opened(await subscribe(app!, OWNER.token, { signal: abort.signal }));
    for (let i = 0; i < 18; i++) opened(await subscribe(app!, OWNER.token, { profile: `reader-${i}` }));

    await refused(await subscribe(app!, OWNER.token, { profile: "overflow" }));
    await opened(await subscribe(app!, other)).cancel();
    if (sibling) await opened(await subscribe(sibling)).cancel();

    abort.abort();
    opened(await subscribe(app!));
    expire();
    opened(await subscribe(app!));
    await refused(await subscribe(app!));

    // Close one fresh tail and verify a failed initial read does not hold its slot.
    const freshDeadline = [...deadlines].at(-1)!;
    freshDeadline();
    const invalid = await subscribe(app!, OWNER.token, { query: "?after=99999" });
    expect(invalid.status).toBe(400);
    await invalid.body?.cancel();
    const replacement = opened(await subscribe(app!));
    await replacement.cancel();
    opened(await subscribe(app!));
    await refused(await subscribe(app!));
    await first.cancel();
    await refused(await subscribe(app!));
  } finally {
    await cluster.close();
  }
});

test("caps the organization at 500 streams across its principals", async () => {
  const cluster = makeApp({ schedule: () => () => {} });
  try {
    const app = cluster.instances[0]!;
    const tokens = [OWNER.token];
    for (let i = 0; i < 25; i++) tokens.push(await createReader(app, `reader-${i}`));
    const extra = tokens.pop()!;
    const first = opened(await subscribe(app));
    for (let i = 1; i < 500; i++) opened(await subscribe(app, tokens[i % tokens.length]));
    await refused(await subscribe(app, extra));
    await first.cancel();
    opened(await subscribe(app, extra));
    await refused(await subscribe(app, extra));
  } finally {
    await cluster.close();
  }
});
