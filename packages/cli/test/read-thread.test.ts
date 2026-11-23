import { expect, test } from "bun:test";
import { runCli } from "../src/main.ts";

const env = { BOARD_URL: "http://127.0.0.1:8787/api/local/main" };
const message = (id: string, text: string) => ({ id, text });

function run(argv: string[], answer: unknown) {
  const lines = { out: [] as string[], err: [] as string[] };
  const urls: string[] = [];
  const fetch = async (request: Request) => {
    urls.push(request.url);
    return new Response(JSON.stringify(answer), { headers: { "content-type": "application/json" } });
  };
  const output = { out: (line: string) => lines.out.push(line), err: (line: string) => lines.err.push(line) };
  return { code: runCli(argv, env, { fetch, output }), lines, urls };
}

test("ob read <id> prints the message, then each reply indented under it", async () => {
  const thread = { message: message("1", "hello"), replies: [message("2", "on it"), message("3", "done\nnotes")] };
  const { code, lines, urls } = run(["read", "1"], thread);
  expect(await code).toBe(0);
  expect(lines.out).toEqual(["#1  hello", "  #2  on it", "  #3  done …"]);
  expect(urls).toEqual([`${env.BOARD_URL}/messages/1`]);
});

test("ob read <id> --json prints the thread as the board answers it", async () => {
  const thread = { message: message("1", "hello"), replies: [] };
  const { code, lines } = run(["read", "1", "--json"], thread);
  expect(await code).toBe(0);
  expect(JSON.parse(lines.out.join("\n"))).toEqual(thread);
});

test("ob reply <id> <text> posts in the thread and prints the reply's ID", async () => {
  const requests: { url: string; body: unknown }[] = [];
  const lines: string[] = [];
  const fetch = async (request: Request) => {
    requests.push({ url: request.url, body: await request.json() });
    const answer = { message: { ...message("2", "on it"), re: "1" } };
    return new Response(JSON.stringify(answer), { status: 201, headers: { "content-type": "application/json" } });
  };
  const output = { out: (line: string) => lines.push(line), err: () => {} };
  expect(await runCli(["reply", "1", "on it"], env, { fetch, output })).toBe(0);
  expect(lines).toEqual(["2"]);
  expect(requests).toEqual([{ url: `${env.BOARD_URL}/messages`, body: { re: "1", text: "on it" } }]);
});

test("ob post --help shows the channel as required, since a post without one reads text as the channel", async () => {
  const lines: string[] = [];
  const output = { out: (line: string) => lines.push(line), err: () => {} };
  expect(await runCli(["post", "--help"], env, { output })).toBe(0);
  expect(lines[0]).toStartWith("ob post <channel> <text>");
});

test("ob read <channel> prints a summary per thread and previews its latest reply", async () => {
  const page = {
    threads: [
      { message: message("2", "quiet"), replies: 0, last: null },
      { message: message("1", "busy"), replies: 1, last: message("3", "on it") },
    ],
    cursor: "3",
  };
  const { code, lines, urls } = run(["read", "dev"], page);
  expect(await code).toBe(0);
  expect(lines.out).toEqual(["#2  quiet  (0 replies)", "#1  busy  (1 reply)", "  Latest reply: #3  on it"]);
  expect(urls).toEqual([`${env.BOARD_URL}/threads?channel=dev`]);
});

test("ob read rejects flat-message cursor flags without calling the board", async () => {
  const { code, urls } = run(["read", "1", "--after", "2"], {});
  expect(await code).toBe(2);
  expect(urls).toEqual([]);
});
