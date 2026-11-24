import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test.each([
  ["post", "dev", { channel: "dev" }],
  ["reply", "2", { re: "2" }],
])("ob %s sends --no-sync as a boolean and respects --", async (command, target, input) => {
  const board = fakeBoard(201, { message: message("3", "hello") });
  const { output } = capture();
  expect(await runCli([command, target, "hello", "--no-sync"], env, { fetch: board.fetch, output })).toBe(0);
  expect(await runCli([command, target, "--", "--no-sync"], env, { fetch: board.fetch, output })).toBe(0);
  expect(board.seen.map(({ body }) => JSON.parse(body))).toEqual([
    { ...input, text: "hello", noSync: true },
    { ...input, text: "--no-sync" },
  ]);
});

test("ob post rejects a missing idempotency key before --no-sync", async () => {
  const board = fakeBoard(201, { message: message("3", "hello") });
  const { lines, output } = capture();
  const argv = ["post", "dev", "hello", "--idempotency-key", "--no-sync"];
  expect(await runCli(argv, env, { fetch: board.fetch, output })).toBe(2);
  expect(lines.err[0]).toStartWith("error: invalid_request: --idempotency-key takes a value");
  expect(board.seen).toEqual([]);
});

test("ob post --file sends the exact file and rejects a second text argument", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ob-post-"));
  try {
    const file = join(directory, "report.md");
    const text = "Before\n~~~json#sandbox@1\n{}\n~~~\nAfter\n";
    writeFileSync(file, text);
    const board = fakeBoard(201, { message: message("3", text) });
    const { output } = capture();
    const options = { fetch: board.fetch, output };
    expect(await runCli(["post", "dev", "--file", file, "--no-sync"], env, options)).toBe(0);
    expect(await runCli(["post", "dev", "other", "--file", file], env, options)).toBe(2);
    expect(board.seen.map(({ body }) => JSON.parse(body))).toEqual([{ channel: "dev", text, noSync: true }]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("ob reply --after", () => {
  test("sends after with the reply", async () => {
    const board = fakeBoard(201, { message: message("3", "a") });
    const { lines, output } = capture();
    expect(await runCli(["reply", "1", "a", "--after", "2"], env, { fetch: board.fetch, output })).toBe(0);
    expect(lines.out).toEqual(["3"]);
    expect(board.seen.map(({ body }) => JSON.parse(body))).toEqual([{ re: "1", text: "a", after: "2" }]);
  });

  test("prints newer_message with the command that reads what came after, and exits 1", async () => {
    const next = [{ kind: "run", argv: ["ob", "read", "1", "--after", "2"] }];
    const board = fakeBoard(409, { error: { code: "newer_message", message: "#3 came after #2", next } });
    const { lines, output } = capture();
    expect(await runCli(["reply", "1", "b", "--after", "2"], env, { fetch: board.fetch, output })).toBe(1);
    expect(lines.err).toEqual(["error: newer_message: #3 came after #2", "next: ob read 1 --after 2"]);
  });

  test.each([
    ["without its value", ["reply", "1", "a", "--after"]],
    ["followed by another option", ["reply", "1", "a", "--after", "--no-sync"]],
    ["spelled as an unknown option", ["reply", "1", "a", "--before", "2"]],
  ])("exits 2 for --after %s", async (_, argv) => {
    const board = fakeBoard(201, {});
    const { output } = capture();
    expect(await runCli(argv, env, { fetch: board.fetch, output })).toBe(2);
    expect(board.seen).toEqual([]);
  });
});

describe("ob post and ob messages", () => {
  test("ob post prints the new message's ID", async () => {
    const board = fakeBoard(201, { message: message("1", "hello") });
    const { lines, output } = capture();
    expect(await runCli(["post", "dev", "hello"], env, { fetch: board.fetch, output })).toBe(0);
    expect(lines.out).toEqual(["1"]);
    expect(board.seen).toEqual([
      { method: "POST", url: `${env.BOARD_URL}/messages`, body: JSON.stringify({ channel: "dev", text: "hello" }) },
    ]);
  });

  test("ob post --idempotency-key sends it as the post's id", async () => {
    const board = fakeBoard(201, { message: message("1", "deploy") });
    const { lines, output } = capture();
    const argv = ["post", "dev", "deploy", "--idempotency-key", "deploy-1"];
    expect(await runCli(argv, env, { fetch: board.fetch, output })).toBe(0);
    expect(lines.out).toEqual(["1"]);
    expect(board.seen.map(({ body }) => JSON.parse(body))).toEqual([
      { channel: "dev", text: "deploy", id: "deploy-1" },
    ]);
    expect(await runCli(["post", "dev", "deploy", "--id", "deploy-1"], env, { fetch: board.fetch, output })).toBe(2);
  });

  test("ob messages prints one line per message, oldest first, then the command that reads on", async () => {
    const board = fakeBoard(200, { messages: [message("1", "hello"), message("2", "two\nlines")], cursor: "2" });
    const { lines, output } = capture();
    expect(await runCli(["messages", "dev"], env, { fetch: board.fetch, output })).toBe(0);
    expect(lines.out).toEqual(["#1  hello", "#2  two …", "next: ob messages dev --after 2"]);
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

const queryOf = (url: string | undefined) => Object.fromEntries(new URL(url ?? "").searchParams);

describe("ob channels pages", () => {
  test("passes the prefix and options, and prints the command for the next page", async () => {
    const board = fakeBoard(200, { channels: [{ path: "dev", messages: 1, threads: 1 }], cursor: "2", next: "dev" });
    const { lines, output } = capture();
    expect(await runCli(["channels", "dev", "--limit", "1"], env, { fetch: board.fetch, output })).toBe(0);
    expect(queryOf(board.seen[0]?.url)).toEqual({ prefix: "dev", limit: "1" });
    expect(lines.out).toEqual(["dev  1 thread · 1 message\n\n(more not shown: ob channels dev --limit 1 --after dev)"]);
  });

  test("round-trips a list prefix that is also a subcommand", async () => {
    const board = fakeBoard(200, { channels: [{ path: "create" }], cursor: "2", next: "create" });
    const { lines, output } = capture();
    expect(await runCli(["channels", "--limit", "1", "--", "create"], env, { fetch: board.fetch, output })).toBe(0);
    expect(queryOf(board.seen[0]?.url)).toEqual({ prefix: "create", limit: "1" });
    expect(lines.out).toEqual(["create\n\n(more not shown: ob channels --limit 1 --after create -- create)"]);

    const next = ["channels", "--limit", "1", "--after", "create", "--", "create"];
    expect(await runCli(next, env, { fetch: board.fetch, output })).toBe(0);
    expect(queryOf(board.seen[1]?.url)).toEqual({ prefix: "create", limit: "1", after: "create" });
  });

  test("prints no next-page line on the last page", async () => {
    const board = fakeBoard(200, { channels: [{ path: "dev/web" }], cursor: "2", next: null });
    const { lines, output } = capture();
    expect(
      await runCli(["channels", "dev", "--limit", "1", "--after", "dev"], env, { fetch: board.fetch, output }),
    ).toBe(0);
    expect(queryOf(board.seen[0]?.url)).toEqual({ prefix: "dev", limit: "1", after: "dev" });
    expect(lines.out).toEqual(["dev/web"]);
  });

  test("puts a prefix that starts with a dash after -- in the next-page command", async () => {
    const board = fakeBoard(200, { channels: [], cursor: "2", next: "x" });
    const { lines, output } = capture();
    expect(await runCli(["channels", "--", "--x"], env, { fetch: board.fetch, output })).toBe(0);
    expect(board.seen[0]?.url).toBe(`${env.BOARD_URL}/channels?prefix=--x`);
    expect(lines.out).toEqual(["\n(more not shown: ob channels --after x -- --x)"]);
  });

  test.each([
    ["an unknown option", ["channels", "--page", "2"]],
    ["an option without its value", ["channels", "--limit"]],
    ["a second prefix", ["channels", "dev", "ops"]],
    ["a positional field given as an option", ["channels", "--prefix", "dev"]],
    ["a word that looks like an option, without --", ["post", "dev", "--text"]],
  ])("exits 2 for %s", async (_, argv) => {
    const board = fakeBoard(200, {});
    const { output } = capture();
    expect(await runCli(argv, env, { fetch: board.fetch, output })).toBe(2);
    expect(board.seen).toEqual([]);
  });
});

describe("ob post --label", () => {
  test("sends each k=v as a label, the value after the first =, the last for a repeated key", async () => {
    const board = fakeBoard(201, { message: message("3", "x") });
    const { output } = capture();
    const argv = ["post", "dev", "x", "--label", "status=new", "--label", "url=a=b", "--label", "status=open"];
    expect(await runCli(argv, env, { fetch: board.fetch, output })).toBe(0);
    expect(board.seen.map(({ body }) => JSON.parse(body))).toEqual([
      { channel: "dev", text: "x", labels: { status: "open", url: "a=b" } },
    ]);
  });

  test.each([
    ["without =", ["--label", "status"], "--label takes k=v, a key and a value"],
    ["without a key", ["--label", "=open"], "--label takes k=v, a key and a value"],
    ["without a value", ["--label", "status="], "--label takes k=v, a key and a value"],
    ["without its value", ["--label"], "--label takes a value"],
  ])("exits 2 for --label %s, posting nothing", async (_, extra, error) => {
    const board = fakeBoard(201, {});
    const { lines, output } = capture();
    expect(await runCli(["post", "dev", "x", ...extra], env, { fetch: board.fetch, output })).toBe(2);
    expect(lines.err[0]).toStartWith(`error: invalid_request: ${error}`);
    expect(board.seen).toEqual([]);
  });
});

describe("ob label", () => {
  test("sends each k=v argument after the ID as a label to set, the last for a repeated key", async () => {
    const board = fakeBoard(200, { ok: true });
    const { output } = capture();
    const argv = ["label", "2", "status=new", "url=a=b", "status=done"];
    expect(await runCli(argv, env, { fetch: board.fetch, output })).toBe(0);
    expect(board.seen.map(({ method, url }) => `${method} ${url}`)).toEqual([
      `POST ${env.BOARD_URL}/messages/2/labels`,
    ]);
    expect(board.seen.map(({ body }) => JSON.parse(body))).toEqual([{ set: { status: "done", url: "a=b" } }]);
  });

  test("sends each --unset as a key to remove, alone or with labels to set", async () => {
    const board = fakeBoard(200, { ok: true });
    const { output } = capture();
    expect(await runCli(["label", "2", "--unset", "status"], env, { fetch: board.fetch, output })).toBe(0);
    const argv = ["label", "2", "owner=me", "--unset", "status", "--unset", "wake"];
    expect(await runCli(argv, env, { fetch: board.fetch, output })).toBe(0);
    expect(board.seen.map(({ body }) => JSON.parse(body))).toEqual([
      { unset: ["status"] },
      { set: { owner: "me" }, unset: ["status", "wake"] },
    ]);
  });

  test("leaves a write with nothing to set or unset to the board, which refuses it", async () => {
    const refusal = { error: { code: "invalid_request", message: "a label write sets or unsets at least one label" } };
    const board = fakeBoard(400, refusal);
    const { lines, output } = capture();
    expect(await runCli(["label", "2"], env, { fetch: board.fetch, output })).toBe(1);
    expect(board.seen.map(({ body }) => JSON.parse(body))).toEqual([{}]);
    expect(lines.err[0]).toStartWith("error: invalid_request: a label write sets or unsets at least one label");
  });

  test.each([
    ["--unset without a key", ["label", "2", "--unset"], "--unset takes a value"],
    ["a label without =", ["label", "2", "status"], "each label takes k=v, a key and a value"],
    ["a label without a value", ["label", "2", "status="], "each label takes k=v, a key and a value"],
  ])("exits 2 for %s, sending nothing", async (_, argv, error) => {
    const board = fakeBoard(200, {});
    const { lines, output } = capture();
    expect(await runCli(argv, env, { fetch: board.fetch, output })).toBe(2);
    expect(lines.err[0]).toStartWith(`error: invalid_request: ${error}`);
    expect(board.seen).toEqual([]);
  });
});

test("ob label combines repeatable --if and --if-unset flags into the if map", async () => {
  const board = fakeBoard(200, { ok: true });
  const { output } = capture();
  const argv = ["label", "2", "owner=me", "--if", "state=", "--if-unset", "owner", "--if", "ready=yes"];
  expect(await runCli(argv, env, { fetch: board.fetch, output })).toBe(0);
  expect(board.seen.map(({ body }) => JSON.parse(body))).toEqual([
    { set: { owner: "me" }, if: { state: "", owner: null, ready: "yes" } },
  ]);
});
