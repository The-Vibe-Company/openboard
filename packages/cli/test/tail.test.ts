import { expect, mock, test } from "bun:test";
import { Writable } from "node:stream";
import { runCli } from "../src/main.ts";
import { writeLine } from "../src/stream-output.ts";

const env = { BOARD_URL: "http://127.0.0.1:8787/api/local/main" };
const author = { name: "fixer-2" };
const event = (id: string, text: string, type = "message.posted") => ({
  cursor: id,
  type,
  createdAt: "2026-11-24T00:00:00.000Z",
  message: { id, text, channel: "dev", author },
});

/** Runs `ob tail` against canned answers; Ctrl-C arrives once `lines` lines are printed. */
function run(argv: string[], answers: Response[], lines = 1) {
  const printed = { out: [] as string[], err: [] as string[] };
  const requests: { url: string; lastEventId: string | null }[] = [];
  const interrupt = new AbortController();
  const fetch = async (request: Request) => {
    const url = new URL(request.url);
    requests.push({ url: url.pathname + url.search, lastEventId: request.headers.get("last-event-id") });
    const answer = answers.shift();
    if (answer === undefined) throw new Error("unexpected request");
    return answer;
  };
  const output = {
    out: (line: string) => {
      printed.out.push(line);
      if (printed.out.length >= lines) interrupt.abort();
    },
    err: (line: string) => printed.err.push(line),
  };
  const code = runCli(["tail", ...argv], env, { fetch, output, interrupt: interrupt.signal });
  return { code, printed, requests };
}

function stream(...events: ReturnType<typeof event>[]): Response {
  const body = events.map((e) => `id: ${e.cursor}\nevent: board\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

test("ob tail <channel> prints each new post as it lands until Ctrl-C, then exits 130", async () => {
  const { code, printed, requests } = run(
    ["dev"],
    [Response.json({ events: [], cursor: "3" }), stream(event("4", "hi"))],
  );
  expect(await code).toBe(130);
  expect(printed.out).toEqual(["#4  dev  fixer-2: hi"]);
  expect(printed.err).toEqual([]);
  expect(requests).toEqual([
    { url: "/api/local/main/events?channel=dev", lastEventId: null },
    { url: "/api/local/main/events?channel=dev", lastEventId: "3" },
  ]);
});

test("ob tail exits 130 when Ctrl-C arrives while the stream is open and quiet", async () => {
  const interrupt = new AbortController();
  const lines = { out: [] as string[], err: [] as string[] };
  let opened: () => void = () => {};
  const streaming = new Promise<void>((resolve) => {
    opened = resolve;
  });
  const fetch = async (request: Request) => {
    if (request.headers.get("last-event-id") === null) return Response.json({ events: [], cursor: "3" });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        request.signal.addEventListener("abort", () => controller.error(request.signal.reason), { once: true });
        opened();
      },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  };
  const output = { out: (line: string) => lines.out.push(line), err: (line: string) => lines.err.push(line) };
  const code = runCli(["tail", "dev"], env, { fetch, output, interrupt: interrupt.signal });
  await streaming;
  interrupt.abort();
  expect(await code).toBe(130);
  expect(lines).toEqual({ out: [], err: [] });
});

test("ob tail <channel> --last 3 prints the three newest events first, oldest first", async () => {
  const page = { events: [event("2", "a"), event("3", "b", "message.edited"), event("4", "c")], cursor: "4" };
  const { code, printed, requests } = run(["dev", "--last", "3"], [Response.json(page)], 3);
  expect(await code).toBe(130);
  expect(printed.out).toEqual(["#2  dev  fixer-2: a", "message.edited  #3  dev  fixer-2: b", "#4  dev  fixer-2: c"]);
  expect(requests).toEqual([{ url: "/api/local/main/events?channel=dev&last=3", lastEventId: null }]);
});

test("ob tail --last 1 prints a watcher failure", async () => {
  const failed = {
    cursor: "8",
    type: "watch.failed",
    createdAt: "2026-11-24T00:00:00.000Z",
    payload: { matched: "4-000000000001", thread: "4", watcher: "triage", error: "timeout" },
  };
  const { code, printed } = run(["dev", "--last", "1"], [Response.json({ events: [failed], cursor: "8" })]);
  expect(await code).toBe(130);
  expect(printed.out).toEqual(['watch.failed  #4  triage: "timeout"']);
  expect(printed.err).toEqual([]);
});

test("ob tail --json prints one event per line as the board serves it", async () => {
  const posted = event("4", "hi");
  const { code, printed } = run(["--json", "dev"], [Response.json({ events: [], cursor: "3" }), stream(posted)]);
  expect(await code).toBe(130);
  expect(printed.out.map((line) => JSON.parse(line))).toEqual([posted]);
});

test("ob tail exits 1 with the board's error", async () => {
  const refused = Response.json({ error: { code: "invalid_request", message: "bad channel" } }, { status: 400 });
  const { code, printed } = run(["dev"], [refused]);
  expect(await code).toBe(1);
  expect(printed.err[0]).toBe("error: invalid_request: bad channel");
});

test.each([
  ["no channel", []],
  ["two channels", ["dev", "ops"]],
  ["--last 0", ["dev", "--last", "0"]],
  ["--last over 100", ["dev", "--last", "101"]],
  ["--last without its value", ["dev", "--last"]],
  ["an unknown option", ["dev", "--after", "3"]],
])("ob tail exits 2 for %s, without calling the board", async (_, argv) => {
  const { code, requests, printed } = run(argv, []);
  expect(await code).toBe(2);
  expect(requests).toEqual([]);
  expect(printed.err[0]).toStartWith("error: invalid_request: ");
});

test.each(["drain", "interrupt", "EPIPE"] as const)("tail stdout handles %s under backpressure", async (outcome) => {
  const interrupt = new AbortController();
  const { promise: writing, resolve: started } = Promise.withResolvers<(error?: Error) => void>();
  const stream = new Writable({
    highWaterMark: 1,
    write(chunk, _, done) {
      expect(String(chunk)).toBe("event\n");
      started(done);
    },
  });
  let settled = false;
  const pending = writeLine(stream, "event", interrupt.signal).then((written) => {
    settled = true;
    return written;
  });
  const done = await writing;
  expect(stream.writableNeedDrain).toBe(true);
  expect(settled).toBe(false);
  if (outcome === "interrupt") {
    interrupt.abort();
    expect(await pending).toBe(false);
  }
  done(outcome === "drain" ? undefined : Object.assign(new Error("closed pipe"), { code: "EPIPE" }));
  expect(await pending).toBe(outcome === "drain");
  expect(stream.listenerCount("drain")).toBe(0);
});

test("tail --json stops consuming events while stdout is blocked", async () => {
  const interrupt = new AbortController();
  const { promise: blocked, resolve: writing } = Promise.withResolvers<void>();
  const write = mock(async (_line: string, signal: AbortSignal) => {
    writing();
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    return false;
  });
  const pending = runCli(["tail", "dev", "--json", "--last", "2"], env, {
    interrupt: interrupt.signal,
    fetch: async () => Response.json({ events: [event("1", "first"), event("2", "second")], cursor: "2" }),
    output: { out() {}, err() {}, write },
  });
  await blocked;
  interrupt.abort();
  expect(await pending).toBe(130);
  expect(write.mock.calls.map(([line]) => line)).toEqual([JSON.stringify(event("1", "first"))]);
});
