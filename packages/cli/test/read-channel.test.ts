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

test("ob messages <channel> --after --limit reads the page after the cursor and prints the command that reads on", async () => {
  const { code, lines, urls } = run(["messages", "dev", "--after", "1", "--limit", "1"], {
    messages: [message("2", "b")],
    cursor: "2",
  });
  expect(await code).toBe(0);
  expect(lines.out).toEqual(["#2  b", "next: ob messages dev --after 2 --limit 1"]);
  expect(urls).toEqual([`${env.BOARD_URL}/messages?channel=dev&after=1&limit=1`]);
});

test("ob messages <channel> --after prints no next line for an empty page", async () => {
  const { code, lines } = run(["messages", "--after", "4", "dev"], { messages: [], cursor: "4" });
  expect(await code).toBe(0);
  expect(lines.out).toEqual([]);
});

test("ob messages <channel> --json prints the page as the board answers it", async () => {
  const page = { messages: [message("3", "c")], cursor: "3" };
  const { code, lines } = run(["messages", "dev", "--after", "2", "--json"], page);
  expect(await code).toBe(0);
  expect(JSON.parse(lines.out.join("\n"))).toEqual(page);
});

test.each([
  ["a limit that is not a whole number", ["messages", "dev", "--limit", "two"]],
  ["a limit over 500", ["messages", "dev", "--limit", "501"]],
  ["an option without its value", ["messages", "dev", "--after"]],
  ["an unknown option", ["messages", "dev", "--before", "3"]],
])("ob messages exits 2 for %s, without calling the board", async (_, argv) => {
  const { code, urls } = run(argv, {});
  expect(await code).toBe(2);
  expect(urls).toEqual([]);
});

test("ob read <channel> --text sends the text and keeps it in the command for older threads", async () => {
  const thread = { message: message("2", "Deploy failed"), replies: 0, last: null };
  const { code, lines, urls } = run(["read", "dev", "--text", "deploy failed", "--limit", "1"], {
    threads: [thread],
    cursor: "3",
    older: "2.2",
  });
  expect(await code).toBe(0);
  expect(urls).toEqual([`${env.BOARD_URL}/threads?channel=dev&text=deploy+failed&limit=1`]);
  expect(lines.out.at(-1)).toBe("older: ob read dev --text 'deploy failed' --before 2.2 --limit 1");
});

test("ob read <id> --text exits 2 without calling the board, since only a channel is searched", async () => {
  const { code, urls } = run(["read", "2", "--text", "deploy"], {});
  expect(await code).toBe(2);
  expect(urls).toEqual([]);
});

test("ob read --by me keeps the explicit actor profile when paging older threads", async () => {
  const { code, lines, urls } = run(["--as", "bot", "read", "dev", "--by", "me", "--limit", "1"], {
    threads: [{ message: message("2", "written by bot"), replies: 0, last: null }],
    cursor: "3",
    older: "2.2",
  });
  expect(await code).toBe(0);
  expect(urls).toEqual([`${env.BOARD_URL}/threads?channel=dev&by=me&limit=1`]);
  expect(lines.out.at(-1)).toBe("older: ob --as bot read dev --by me --before 2.2 --limit 1");
});
