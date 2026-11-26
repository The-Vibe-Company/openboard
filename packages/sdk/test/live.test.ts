import { expect, mock, test } from "bun:test";
import { BoardError, type BoardEvent, retryDelayMs, tail } from "../src/index.ts";

const url = "http://127.0.0.1:8787/api/local/main";
const token = "fixture";
const encoder = new TextEncoder();

function posted(cursor: string, text: string): BoardEvent {
  const event = {
    cursor,
    type: "message.posted",
    createdAt: "2026-01-01T00:00:00.000Z",
    payload: { channel: "dev", text },
  };
  // A partial event is enough: the SDK passes each frame's JSON through untouched.
  return event as unknown as BoardEvent;
}

const frame = (event: BoardEvent) => `id: ${event.cursor}\nevent: board\ndata: ${JSON.stringify(event)}\n\n`;

/** An SSE response whose chunks the test pushes one by one. */
function liveResponse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      cancelled = true;
    },
  });
  const response = new Response(body, { headers: { "content-type": "text/event-stream" } });
  return {
    response,
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
    fail: () => controller.error(new TypeError("terminated")),
    cancelled: () => cancelled,
  };
}

test("tail yields each board event of the SSE stream as it lands", async () => {
  const live = liveResponse();
  const requests: Request[] = [];
  const events = tail({
    url,
    token,
    channel: "dev",
    after: "0",
    fetch: async (request) => {
      requests.push(request);
      return live.response;
    },
  });

  live.push(": connected\n\nid: 2\n\n");
  live.push(frame(posted("3", "one")));
  expect((await events.next()).value).toEqual(posted("3", "one"));

  const second = JSON.stringify(posted("4", "two\nlines"));
  live.push(`: ping\r\nid: 4\r\nevent: board\r\ndata: ${second.slice(0, 20)}`);
  live.push(`${second.slice(20)}\r`);
  live.push("\n\r\n");
  expect((await events.next()).value).toEqual(posted("4", "two\nlines"));

  await events.return();
  const [request] = requests;
  expect(requests).toHaveLength(1);
  expect(new URL(request?.url ?? "").pathname).toBe("/api/local/main/events");
  expect(new URL(request?.url ?? "").searchParams.get("channel")).toBe("dev");
  expect(request?.headers.get("accept")).toStartWith("text/event-stream");
  expect(request?.headers.get("authorization")).toBe(`Bearer ${token}`);
});

test("tail joins multi-line data and skips frames that are not board events", async () => {
  const live = liveResponse();
  const events = tail({ url, token, after: "0", fetch: async () => live.response });
  const event = posted("5", "split");
  const json = JSON.stringify(event);
  live.push(`event: other\ndata: {}\n\nid: 5\nevent: board\ndata:${json.slice(0, 10)}\ndata:${json.slice(10)}\n\n`);
  // The `data:` lines join with a newline; the split falls between JSON tokens, so it parses back.
  expect((await events.next()).value).toEqual(event);
  await events.return();
});

test("leaving the loop closes the stream", async () => {
  const live = liveResponse();
  live.push(frame(posted("3", "one")));
  for await (const event of tail({ url, token, after: "0", fetch: async () => live.response })) {
    expect(event.cursor).toBe("3");
    break;
  }
  expect(live.cancelled()).toBe(true);
});

test("tail long-polls by cursor when the board answers with JSON", async () => {
  const abort = new AbortController();
  const seen: URL[] = [];
  const pages = [
    { cursor: "2", events: [] },
    { cursor: "3", events: [posted("3", "one")] },
    { cursor: "4", events: [posted("4", "two")] },
  ];
  const got: string[] = [];
  const fetch = async (request: Request) => {
    seen.push(new URL(request.url));
    return Response.json(pages[seen.length - 1]);
  };
  for await (const event of tail({ url, token, channel: "dev", after: "1", signal: abort.signal, fetch })) {
    got.push(event.cursor);
    if (got.length === 2) abort.abort();
  }
  expect(got).toEqual(["3", "4"]);
  expect(
    seen.map((u) => [u.searchParams.get("after"), u.searchParams.get("wait"), u.searchParams.get("channel")]),
  ).toEqual([
    ["1", null, "dev"],
    ["2", "30", "dev"],
    ["3", "30", "dev"],
  ]);
});

test("aborting a waiting tail ends it quietly", async () => {
  const abort = new AbortController();
  const events = tail({
    url,
    token,
    signal: abort.signal,
    fetch: (request) =>
      new Promise((_, reject) => request.signal.addEventListener("abort", () => reject(request.signal.reason))),
  });
  const next = events.next();
  abort.abort();
  expect((await next).done).toBe(true);
});

test("a refused tail throws the board's error", async () => {
  const fetch = async () =>
    Response.json({ error: { code: "unauthorized", message: "missing or invalid token" } }, { status: 401 });
  const error = await tail({ url, fetch })
    .next()
    .catch((e: unknown) => e);
  expect(error).toBeInstanceOf(BoardError);
  expect((error as BoardError).code).toBe("unauthorized");
});

test("a board that does not answer is unreachable", async () => {
  const fetch = async () => {
    throw new TypeError("connection refused");
  };
  const error = await tail({ url, token, fetch })
    .next()
    .catch((e: unknown) => e);
  expect((error as BoardError).code).toBe("unreachable");
});

test.each(["close", "fail"] as const)("tail resumes after stream %s and connection refusal", async (end) => {
  const before = liveResponse();
  const after = liveResponse();
  const seen: Request[] = [];
  const pause = mock(async () => {});
  const events = tail({
    url,
    token,
    channel: "dev",
    after: "2",
    retryDelay: pause,
    fetch: async (request) => {
      seen.push(request);
      if (seen.length === 1) return before.response;
      if (seen.length === 2) throw new TypeError("connection refused");
      return after.response;
    },
  });
  before.push(`${frame(posted("3", "one"))}id: 4\n\nid: 5\nevent: board\ndata: {`);
  expect((await events.next()).value).toEqual(posted("3", "one"));
  // The complete checkpoint survives, but the interrupted event does not.
  before[end]();
  const next = events.next();
  after.push(frame(posted("5", "two")) + frame(posted("6", "three")));
  expect((await next).value).toEqual(posted("5", "two"));
  expect((await events.next()).value).toEqual(posted("6", "three"));
  await events.return();

  expect(pause).toHaveBeenCalledTimes(2);
  expect(seen.map((request) => new URL(request.url).search)).toEqual([
    "?channel=dev&after=2",
    "?channel=dev",
    "?channel=dev",
  ]);
  expect(seen.map((request) => request.headers.get("last-event-id"))).toEqual([null, "4", "4"]);
});

test.each([false, true])("default tail keeps its initial cursor (disconnect: %s)", async (disconnect) => {
  const firstStream = liveResponse();
  const resumedStream = liveResponse();
  const pause = mock(async () => {});
  const seen: Array<{ accept: string | null; cursor: string | null; query: string }> = [];
  const firstPost = posted("3", "between the snapshot and the subscription");
  const secondPost = posted("4", "after the subscription attempt");
  const events = tail({
    url,
    token,
    channel: "dev",
    retryDelay: pause,
    fetch: async (request) => {
      const accept = request.headers.get("accept");
      const cursor = request.headers.get("last-event-id");
      seen.push({ accept, cursor, query: new URL(request.url).search });
      if (seen.length === 1) return Response.json({ cursor: "2", events: [] });
      if (seen.length === 2) return firstStream.response;
      return resumedStream.response;
    },
  });
  firstStream.push(": connected\n\n");
  if (disconnect) firstStream.close();
  const caughtUp = disconnect ? resumedStream : firstStream;
  caughtUp.push(frame(firstPost) + frame(secondPost));
  expect((await events.next()).value).toEqual(firstPost);
  expect((await events.next()).value).toEqual(secondPost);
  await events.return();

  const subscribe = { accept: "text/event-stream, application/json", cursor: "2", query: "?channel=dev" };
  expect(seen).toEqual([
    { accept: "application/json", cursor: null, query: "?channel=dev" },
    subscribe,
    ...(disconnect ? [subscribe] : []),
  ]);
  expect(pause).toHaveBeenCalledTimes(disconnect ? 1 : 0);
});

test("a board frame that is not JSON is a remote error", async () => {
  const live = liveResponse();
  live.push("event: board\ndata: {not json\n\n");
  const error = await tail({ url, token, after: "0", fetch: async () => live.response })
    .next()
    .catch((e: unknown) => e);
  expect((error as BoardError).code).toBe("remote_error");
});

test("a tail started with `last` follows by cursor alone", async () => {
  const abort = new AbortController();
  const seen: URL[] = [];
  const fetch = async (request: Request) => {
    seen.push(new URL(request.url));
    if (seen.length === 3) abort.abort();
    return Response.json({ cursor: "9", events: [posted("9", "newest")] });
  };
  for await (const _ of tail({ url, token, last: 2, signal: abort.signal, fetch })) {
  }
  expect(seen.map((u) => u.search)).toEqual(["?last=2", "", "?after=9&wait=30"]);
});

test("aborting while the stream is open ends the tail quietly", async () => {
  const abort = new AbortController();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      abort.signal.addEventListener("abort", () => controller.error(abort.signal.reason));
    },
  });
  const fetch = async () => new Response(body, { headers: { "content-type": "text/event-stream" } });
  const events = tail({ url, token, after: "0", signal: abort.signal, fetch });
  const next = events.next();
  await Promise.resolve();
  abort.abort();
  expect((await next).done).toBe(true);
});

test("reconnect delays double from 250 ms to 10 s with jitter between half and all of each step", () => {
  expect([0, 1, 2, 3, 6, 20].map((attempt) => retryDelayMs(attempt, () => 1))).toEqual([
    250, 500, 1000, 2000, 10000, 10000,
  ]);
  expect([0, 1, 6].map((attempt) => retryDelayMs(attempt, () => 0))).toEqual([125, 250, 5000]);
});

test("an established tail resumes after proxy failures with a bounded Retry-After", async () => {
  const live = liveResponse();
  live.push(frame(posted("3", "resumed")));
  const requests: Request[] = [];
  const pause = mock(async (_signal?: AbortSignal, _attempt?: number, _retryAfter?: number) => {});
  const responses = [
    new Response("", { headers: { "content-type": "text/event-stream" } }),
    new Response("<html>Bad Gateway</html>", { status: 502 }),
    new Response("<html>Unavailable</html>", { status: 503, headers: { "retry-after": "60" } }),
    new Response("<html>Gateway Timeout</html>", { status: 504, headers: { "retry-after": "2" } }),
    live.response,
  ];
  const events = tail({
    url,
    after: "2",
    retryDelay: pause,
    fetch: async (request) => {
      requests.push(request);
      const response = responses.shift();
      if (!response) throw new Error("unexpected reconnect");
      return response;
    },
  });

  expect((await events.next()).value).toEqual(posted("3", "resumed"));
  await events.return();
  expect(pause.mock.calls.map(([, attempt, retryAfter]) => [attempt, retryAfter])).toEqual([
    [0, undefined],
    [1, undefined],
    [2, 10_000],
    [3, 2_000],
  ]);
  expect(requests.map((request) => new URL(request.url).searchParams.get("after"))).toEqual(Array(5).fill("2"));
});

test.each([
  [401, "remote_error", "null"],
  [403, "unavailable", '{"error":{"code":"unavailable"}}'],
  [400, "invalid_cursor", '{"error":{"code":"invalid_cursor"}}'],
] as const)("HTTP %i stops an established tail and preserves the status", async (status, code, body) => {
  const live = liveResponse();
  live.push(frame(posted("3", "before refusal")));
  live.close();
  const pause = mock(async () => {});
  const fetch = mock(async () => new Response(body, { status })).mockResolvedValueOnce(live.response);
  const events = tail({ url, after: "2", fetch, retryDelay: pause });

  expect((await events.next()).value).toEqual(posted("3", "before refusal"));
  const error = await events.next().catch((error: unknown) => error);
  expect(error).toBeInstanceOf(BoardError);
  expect(error).toMatchObject({ status, code });
  expect(pause).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("rapid SSE EOFs escalate backoff until cursor progress", async () => {
  const abort = new AbortController();
  const requests: Request[] = [];
  const replayed = posted("2", "replayed");
  const bodies = [": ping\n\n", "id: 2\n\n", frame(replayed), "", "id: 3\n\n"];
  const pause = mock(async (_signal?: AbortSignal, _attempt?: number) => {
    if (pause.mock.calls.length === 5) abort.abort();
  });
  const events = tail({
    url,
    after: "2",
    signal: abort.signal,
    retryDelay: pause,
    fetch: async (request) => {
      requests.push(request);
      return new Response(bodies.shift(), { headers: { "content-type": "text/event-stream" } });
    },
  });

  expect((await events.next()).value).toEqual(replayed);
  expect((await events.next()).done).toBe(true);
  expect(pause.mock.calls.map(([, attempt]) => attempt)).toEqual([0, 1, 2, 3, 0]);
  expect(requests.map((request) => request.headers.get("last-event-id"))).toEqual([null, null, "2", "2", "2"]);
});

test("tail reads a final CR-only frame with UTF-8 split across chunks", async () => {
  const event = posted("3", "☃");
  const bytes = encoder.encode(frame(event).replaceAll("\n", "\r"));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  const fetch = async () => new Response(body, { headers: { "content-type": "text/event-stream" } });
  const events = tail({ url, after: "2", fetch });
  expect((await events.next()).value).toEqual(event);
  await events.return();
});

test("tail joins a large multi-line frame split across chunks", async () => {
  const live = liveResponse();
  const event = posted("3", "large frame");
  live.push("id: 3\nevent: board\n");
  for (let chunk = 0; chunk < 64; chunk++) live.push("data:  \n".repeat(512));
  live.push(`data: ${JSON.stringify(event)}\n\n`);
  const events = tail({ url, after: "2", fetch: async () => live.response });
  expect((await events.next()).value).toEqual(event);
  await events.return();
});

test.each([
  ["line", `data: ${" ".repeat(2 * 1024 * 1024)}`],
  ["frame", `data: ${" ".repeat(1024 * 1024)}\n`.repeat(4)],
] as const)("tail switches to JSON polling for an oversized SSE %s", async (_limit, text) => {
  const live = liveResponse();
  live.push(frame(posted("3", "checkpoint")));
  live.push(text);
  const resumed = posted("4", "read using JSON");
  const fetch = mock(async (_request: Request) => Response.json({ cursor: "4", events: [resumed] }));
  fetch.mockResolvedValueOnce(live.response);
  const events = tail({ url, after: "2", fetch });
  expect((await events.next()).value).toEqual(posted("3", "checkpoint"));
  expect((await events.next()).value).toEqual(resumed);
  expect(live.cancelled()).toBe(true);
  const request = fetch.mock.calls[1]?.[0];
  expect(new URL(request?.url ?? "").search).toBe("?after=3&wait=30");
  expect(request?.headers.get("accept")).toBe("application/json");
  await events.return();
});
