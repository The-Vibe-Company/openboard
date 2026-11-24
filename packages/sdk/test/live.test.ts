import { expect, test } from "bun:test";
import { BoardError, type BoardEvent, tail } from "../src/index.ts";

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

  live.close();
  expect((await events.next()).done).toBe(true);
  const [request] = requests;
  expect(requests).toHaveLength(1);
  expect(new URL(request?.url ?? "").pathname).toBe("/api/local/main/events");
  expect(new URL(request?.url ?? "").searchParams.get("channel")).toBe("dev");
  expect(request?.headers.get("accept")).toStartWith("text/event-stream");
  expect(request?.headers.get("authorization")).toBe(`Bearer ${token}`);
});

test("tail joins multi-line data and skips frames that are not board events", async () => {
  const live = liveResponse();
  const events = tail({ url, token, fetch: async () => live.response });
  const event = posted("5", "split");
  const json = JSON.stringify(event);
  live.push(`event: other\ndata: {}\n\nid: 5\nevent: board\ndata:${json.slice(0, 10)}\ndata:${json.slice(10)}\n\n`);
  live.close();

  const got = [];
  for await (const e of events) got.push(e);
  // The `data:` lines join with a newline; the split falls between JSON tokens, so it parses back.
  expect(got).toHaveLength(1);
  expect(got[0]?.cursor).toBe("5");
});

test("leaving the loop closes the stream", async () => {
  const live = liveResponse();
  live.push(frame(posted("3", "one")));
  for await (const event of tail({ url, token, fetch: async () => live.response })) {
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
  for await (const event of tail({ url, token, channel: "dev", signal: abort.signal, fetch })) {
    got.push(event.cursor);
    if (got.length === 2) abort.abort();
  }
  expect(got).toEqual(["3", "4"]);
  expect(
    seen.map((u) => [u.searchParams.get("after"), u.searchParams.get("wait"), u.searchParams.get("channel")]),
  ).toEqual([
    [null, null, "dev"],
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

test("a stream that breaks after it opened is unreachable", async () => {
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(new TypeError("terminated"));
    },
  });
  const fetch = async () => new Response(body, { headers: { "content-type": "text/event-stream" } });
  const error = await tail({ url, token, fetch })
    .next()
    .catch((e: unknown) => e);
  expect(error).toBeInstanceOf(BoardError);
  expect((error as BoardError).code).toBe("unreachable");
});

test("a board frame that is not JSON is a remote error", async () => {
  const live = liveResponse();
  live.push("event: board\ndata: {not json\n\n");
  const error = await tail({ url, token, fetch: async () => live.response })
    .next()
    .catch((e: unknown) => e);
  expect((error as BoardError).code).toBe("remote_error");
});

test("long-polling after `last` follows by cursor alone", async () => {
  const abort = new AbortController();
  const seen: URL[] = [];
  const fetch = async (request: Request) => {
    seen.push(new URL(request.url));
    if (seen.length === 2) abort.abort();
    return Response.json({ cursor: "9", events: [posted("9", "newest")] });
  };
  for await (const _ of tail({ url, token, last: 2, signal: abort.signal, fetch })) {
  }
  expect(seen.map((u) => u.search)).toEqual(["?last=2", "?after=9&wait=30"]);
});

test("aborting while the stream is open ends the tail quietly", async () => {
  const abort = new AbortController();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      abort.signal.addEventListener("abort", () => controller.error(abort.signal.reason));
    },
  });
  const fetch = async () => new Response(body, { headers: { "content-type": "text/event-stream" } });
  const events = tail({ url, token, signal: abort.signal, fetch });
  const next = events.next();
  await Promise.resolve();
  abort.abort();
  expect((await next).done).toBe(true);
});
