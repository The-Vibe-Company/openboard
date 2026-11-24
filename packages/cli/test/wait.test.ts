import { expect, test } from "bun:test";
import { runCli } from "../src/main.ts";

const env = { BOARD_URL: "http://127.0.0.1:8787/api/local/main" };
const reply = (id: string, text: string) => ({
  cursor: id,
  type: "message.posted",
  message: { id, text },
});

function run(argv: string[], thread: string, pages: unknown[], now: () => number = () => 0) {
  const lines = { out: [] as string[], err: [] as string[] };
  const urls: string[] = [];
  const fetch = async (request: Request) => {
    const url = new URL(request.url);
    urls.push(url.pathname + url.search);
    if (url.pathname.endsWith("/events")) {
      const page = pages.shift();
      if (page === undefined) throw new Error("unexpected event request");
      return Response.json(page);
    }
    if (url.pathname.endsWith(`/messages/${argv[0]}`)) {
      return Response.json({ message: { thread }, replies: [] });
    }
    throw new Error("unexpected request");
  };
  const output = { out: (line: string) => lines.out.push(line), err: (line: string) => lines.err.push(line) };
  return { code: runCli(["wait", ...argv], env, { fetch, output, now }), urls, lines };
}

test("ob wait keeps waiting after an empty poll and resumes after the first event rather than the page", async () => {
  const { code, urls, lines } = run(["2"], "2", [
    { cursor: "3", events: [] },
    { cursor: "5", events: [reply("4", "first answer"), reply("5", "second answer")] },
  ]);
  expect(await code).toBe(0);
  expect(urls).toEqual([
    "/api/local/main/messages/2?limit=1",
    "/api/local/main/events?re=2&after=2&wait=120",
    "/api/local/main/events?re=2&after=3&wait=120",
  ]);
  expect(lines.out.join("\n")).toBe("message.posted  #4  first answer\nnext: ob wait 2 --after 4");
  expect(lines.err).toEqual([]);
});

test("ob wait resolves a reply's thread and honors the explicit cursor and profile", async () => {
  const event = reply("7", "new answer");
  const { code, urls, lines } = run(["4", "--after", "6", "--as", "reader", "--json"], "2", [
    { cursor: "7", events: [event] },
  ]);
  expect(await code).toBe(0);
  expect(urls).toEqual(["/api/local/main/messages/4?limit=1", "/api/local/main/events?re=2&after=6&wait=120"]);
  expect(JSON.parse(lines.out.join("\n"))).toEqual({
    event,
    cursor: "7",
    next: "ob wait 4 --after 7 --as reader --json",
  });
});

test("ob wait rejects a missing cursor before calling the board", async () => {
  const { code, urls, lines } = run(["2", "--after"], "2", []);
  expect(await code).toBe(2);
  expect(urls).toEqual([]);
  expect(lines.err[0]).toStartWith("error: invalid_request: --after takes a cursor");
});

test("ob wait exits 1 after the timeout and suggests reading the channel", async () => {
  const times = [0, 0, 2_000];
  const { code, urls, lines } = run(
    ["dev", "--timeout", "2s", "--as", "reader"],
    "",
    [{ cursor: "2", events: [] }],
    () => times.shift() ?? 2_000,
  );
  expect(await code).toBe(1);
  expect(urls).toEqual(["/api/local/main/events?channel=dev&wait=2"]);
  expect(lines.out).toEqual([]);
  expect(lines.err).toEqual(["error: timeout: Nothing matched within 2s.", "next: ob read dev --as reader"]);
});

test("ob wait carries the channel cursor and remaining time into the next poll", async () => {
  const times = [0, 0, 120_500, 120_500, 120_750];
  const { code, urls, lines } = run(
    ["dev", "--timeout", "121s"],
    "",
    [
      { cursor: "3", events: [] },
      { cursor: "4", events: [reply("4", "new post")] },
    ],
    () => times.shift() ?? 121_000,
  );
  expect(await code).toBe(0);
  expect(urls).toEqual([
    "/api/local/main/events?channel=dev&wait=120",
    "/api/local/main/events?channel=dev&after=3&wait=0.5",
  ]);
  expect(lines.out).toEqual(["message.posted  #4  new post\nnext: ob wait dev --after 4 --timeout 121s"]);
  expect(lines.err).toEqual([]);
});

test("ob wait rejects an invalid timeout before calling the board", async () => {
  const { code, urls, lines } = run(["dev", "--timeout", "0s"], "", []);
  expect(await code).toBe(2);
  expect(urls).toEqual([]);
  expect(lines.err[0]).toStartWith("error: invalid_request: --timeout takes a positive duration");
});

test("ob wait cancels a stalled event request when its deadline expires", async () => {
  const deadline = new AbortController();
  const lines: string[] = [];
  let requestSignal: AbortSignal | undefined;
  const code = await runCli(["wait", "dev", "--timeout", "2s"], env, {
    now: () => 0,
    timeoutSignal: (ms) => {
      expect(ms).toBe(2_000);
      return deadline.signal;
    },
    fetch: (request) =>
      new Promise((_resolve, reject) => {
        requestSignal = request.signal;
        request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
        deadline.abort(new DOMException("deadline elapsed", "TimeoutError"));
      }),
    output: { out: (line) => lines.push(`unexpected stdout: ${line}`), err: (line) => lines.push(line) },
  });
  expect(requestSignal?.aborted).toBe(true);
  expect(code).toBe(1);
  expect(lines).toEqual(["error: timeout: Nothing matched within 2s.", "next: ob read dev"]);
});
