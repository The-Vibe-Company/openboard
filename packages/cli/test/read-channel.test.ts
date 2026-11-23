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

test("ob read <channel> --after --limit reads the page after the cursor and prints the command that reads on", async () => {
  const { code, lines, urls } = run(["read", "dev", "--after", "1", "--limit", "1"], {
    messages: [message("2", "b")],
    cursor: "2",
  });
  expect(await code).toBe(0);
  expect(lines.out).toEqual(["#2  b", "next: ob read dev --after 2 --limit 1"]);
  expect(urls).toEqual([`${env.BOARD_URL}/messages?channel=dev&after=1&limit=1`]);
});

test("ob read <channel> --after prints no next line for an empty page", async () => {
  const { code, lines } = run(["read", "--after", "4", "dev"], { messages: [], cursor: "4" });
  expect(await code).toBe(0);
  expect(lines.out).toEqual([]);
});

test("ob read <channel> --json prints the page as the board answers it", async () => {
  const page = { messages: [message("3", "c")], cursor: "3" };
  const { code, lines } = run(["read", "dev", "--after", "2", "--json"], page);
  expect(await code).toBe(0);
  expect(JSON.parse(lines.out.join("\n"))).toEqual(page);
});

test.each([
  ["a limit that is not a whole number", ["read", "dev", "--limit", "two"]],
  ["a limit over 500", ["read", "dev", "--limit", "501"]],
  ["an option without its value", ["read", "dev", "--after"]],
  ["an unknown option", ["read", "dev", "--before", "3"]],
  ["a cursor on a thread read", ["read", "1", "--after", "2"]],
])("ob read exits 2 for %s, without calling the board", async (_, argv) => {
  const { code, urls } = run(argv, {});
  expect(await code).toBe(2);
  expect(urls).toEqual([]);
});
