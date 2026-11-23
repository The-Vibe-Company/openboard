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
