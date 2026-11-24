import { expect, test } from "bun:test";
import { runCli } from "../src/main.ts";

const env = { BOARD_URL: "http://127.0.0.1:8787/api/local/main" };
const reply = (id: string, text: string) => ({
  cursor: id,
  type: "message.posted",
  message: { id, text },
});

function run(argv: string[], thread: string, pages: unknown[]) {
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
    return Response.json({ message: { thread }, replies: [] });
  };
  const output = { out: (line: string) => lines.out.push(line), err: (line: string) => lines.err.push(line) };
  return { code: runCli(["wait", ...argv], env, { fetch, output }), urls, lines };
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
