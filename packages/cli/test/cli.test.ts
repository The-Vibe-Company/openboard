import { describe, expect, test } from "bun:test";
import { runCli } from "../src/main.ts";

const env = { BOARD_URL: "http://127.0.0.1:8787/api/local/main" };

function fakeBoard(status: number, body: unknown) {
  const seen: { method: string; url: string; body: string }[] = [];
  const fetch = async (request: Request) => {
    seen.push({ method: request.method, url: request.url, body: await request.text() });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { fetch, seen };
}

function capture() {
  const lines = { out: [] as string[], err: [] as string[] };
  return {
    lines,
    output: { out: (line: string) => lines.out.push(line), err: (line: string) => lines.err.push(line) },
  };
}

const message = (id: string, text: string) => ({ id, text });

describe("ob post and ob read", () => {
  test("ob post prints the new message's ID", async () => {
    const board = fakeBoard(201, { message: message("1", "hello") });
    const { lines, output } = capture();
    expect(await runCli(["post", "dev", "hello"], env, { fetch: board.fetch, output })).toBe(0);
    expect(lines.out).toEqual(["1"]);
    expect(board.seen).toEqual([
      { method: "POST", url: `${env.BOARD_URL}/messages`, body: JSON.stringify({ channel: "dev", text: "hello" }) },
    ]);
  });

  test("ob read prints one line per message, oldest first", async () => {
    const board = fakeBoard(200, { messages: [message("1", "hello"), message("2", "two\nlines")], cursor: "2" });
    const { lines, output } = capture();
    expect(await runCli(["read", "dev"], env, { fetch: board.fetch, output })).toBe(0);
    expect(lines.out).toEqual(["#1  hello", "#2  two …"]);
    expect(board.seen[0]?.url).toBe(`${env.BOARD_URL}/messages?channel=dev`);
  });

  test("exits 1 with the board's code and message when it refuses", async () => {
    const board = fakeBoard(400, { error: { code: "invalid_request", message: "channel: bad" } });
    const { lines, output } = capture();
    expect(await runCli(["post", "Dev", "x"], env, { fetch: board.fetch, output })).toBe(1);
    expect(lines.err).toEqual(["error: invalid_request: channel: bad"]);
  });

  test("takes the words after -- as arguments, flags included", async () => {
    const board = fakeBoard(201, { message: message("3", "--json") });
    const { lines, output } = capture();
    expect(await runCli(["post", "--", "dev", "--json"], env, { fetch: board.fetch, output })).toBe(0);
    expect(lines.out).toEqual(["3"]);
    expect(board.seen[0]?.body).toBe(JSON.stringify({ channel: "dev", text: "--json" }));
  });

  test("exits 1 with unreachable when nothing answers at BOARD_URL", async () => {
    const { lines, output } = capture();
    const down = async (): Promise<Response> => {
      throw new TypeError("Unable to connect");
    };
    expect(await runCli(["read", "dev"], env, { fetch: down, output })).toBe(1);
    expect(lines.err[0]).toStartWith("error: unreachable: the board at http://127.0.0.1:8787 did not answer");
  });

  test.each([
    ["a BOARD_URL that is not a URL", ["read", "dev"], { BOARD_URL: "notaurl" }],
    ["a BOARD_URL without its scheme", ["read", "dev"], { BOARD_URL: "localhost:1/api" }],
    ["an unknown command", ["nope"], env],
    ["a missing argument", ["post", "dev"], env],
    ["no BOARD_URL", ["read", "dev"], {}],
  ])("exits 2 for %s", async (_, argv, environment) => {
    const { output } = capture();
    expect(await runCli(argv, environment, { fetch: fakeBoard(200, {}).fetch, output })).toBe(2);
  });
});

test("ob channels prints paths when the board omits counts", async () => {
  const board = fakeBoard(200, { channels: [{ path: "dev" }], cursor: "1", next: null });
  const { lines, output } = capture();
  expect(await runCli(["channels"], env, { fetch: board.fetch, output })).toBe(0);
  expect(lines.out).toEqual(["dev"]);
  expect(board.seen).toEqual([{ method: "GET", url: `${env.BOARD_URL}/channels`, body: "" }]);
});
