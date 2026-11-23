import { expect, test } from "bun:test";
import { runCli } from "../src/main.ts";

const env = { BOARD_URL: "http://127.0.0.1:8787/api/local/main" };

/** A board that answers `body` and keeps the `x-board-profile` of every request. */
function fakeBoard(status: number, body: unknown) {
  const profiles: (string | null)[] = [];
  const fetch = async (request: Request) => {
    profiles.push(request.headers.get("x-board-profile"));
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { fetch, profiles };
}

function capture() {
  const lines = { out: [] as string[], err: [] as string[] };
  return {
    lines,
    output: { out: (line: string) => lines.out.push(line), err: (line: string) => lines.err.push(line) },
  };
}

test("--as sends the profile with the request, wherever it stands before --", async () => {
  const board = fakeBoard(201, { message: { id: "1", text: "hi" } });
  const { lines, output } = capture();
  expect(await runCli(["post", "dev", "hi", "--as", "fixer-2"], env, { fetch: board.fetch, output })).toBe(0);
  expect(await runCli(["--as", "fixer-3", "post", "dev", "hi"], env, { fetch: board.fetch, output })).toBe(0);
  expect(board.profiles).toEqual(["fixer-2", "fixer-3"]);
  expect(lines.out).toEqual(["1", "1"]);
});

test("BOARD_PROFILE picks the profile, and --as wins over it", async () => {
  const board = fakeBoard(201, { message: { id: "1", text: "hi" } });
  const { output } = capture();
  const withProfile = { ...env, BOARD_PROFILE: "fixer-1" };
  expect(await runCli(["post", "dev", "hi"], withProfile, { fetch: board.fetch, output })).toBe(0);
  expect(await runCli(["post", "dev", "hi", "--as", "fixer-2"], withProfile, { fetch: board.fetch, output })).toBe(0);
  expect(await runCli(["post", "dev", "hi"], env, { fetch: board.fetch, output })).toBe(0);
  expect(board.profiles).toEqual(["fixer-1", "fixer-2", null]);
});

test("--as after -- is text, not a profile", async () => {
  const board = fakeBoard(201, { message: { id: "1", text: "--as" } });
  const { output } = capture();
  expect(await runCli(["post", "--", "dev", "--as"], env, { fetch: board.fetch, output })).toBe(0);
  expect(board.profiles).toEqual([null]);
});

test("--as without a name is a misuse", async () => {
  const board = fakeBoard(200, {});
  const { lines, output } = capture();
  expect(await runCli(["whoami", "--as"], env, { fetch: board.fetch, output })).toBe(2);
  expect(lines.err[0]).toBe("error: invalid_request: --as takes one profile name: --as fixer-2");
  expect(board.profiles).toEqual([]);
});

test("a message line shows its author, through whom a profile writes", async () => {
  const author = { name: "fixer-2", via: { name: "laptop" } };
  const page = {
    messages: [
      { id: "1", text: "hi", author },
      { id: "2", text: "me", author: { name: "laptop" } },
    ],
  };
  const board = fakeBoard(200, { ...page, cursor: "2" });
  const { lines, output } = capture();
  expect(await runCli(["messages", "dev"], env, { fetch: board.fetch, output })).toBe(0);
  expect(lines.out).toEqual(["#1  fixer-2 via laptop: hi", "#2  laptop: me", "next: ob messages dev --after 2"]);
});
