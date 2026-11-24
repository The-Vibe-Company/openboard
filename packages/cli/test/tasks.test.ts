import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withClaimStorage } from "../src/claims.ts";
import { runCli } from "../src/main.ts";

test("ob tasks create sends a task root and prints its ID", async () => {
  const env = { BOARD_URL: "http://127.0.0.1:8787/api/local/main" };
  const lines: string[] = [];
  const fetch = async (request: Request) => {
    expect(request.method).toBe("POST");
    expect(request.url).toBe(`${env.BOARD_URL}/tasks`);
    expect(await request.json()).toEqual({
      channel: "dev",
      text: "fix the build",
      labels: { repo: "web" },
      noSync: true,
      id: "build-fix",
    });
    return Response.json({ task: { id: "2" } }, { status: 201 });
  };
  const args = [
    "tasks",
    "create",
    "dev",
    "fix the build",
    "--label",
    "repo=web",
    "--no-sync",
    "--idempotency-key",
    "build-fix",
  ];
  expect(
    await runCli(args, env, { fetch, output: { out: (line) => lines.push(line), err: (line) => lines.push(line) } }),
  ).toBe(0);
  expect(lines).toEqual(["2"]);
});

test("ob tasks create <id> makes a task of the thread that message roots and prints its ID", async () => {
  const env = { BOARD_URL: "http://127.0.0.1:8787/api/local/main" };
  const lines: string[] = [];
  const bodies: unknown[] = [];
  const fetch = async (request: Request) => {
    expect(`${request.method} ${request.url}`).toBe(`POST ${env.BOARD_URL}/tasks`);
    bodies.push(await request.json());
    return Response.json({ task: { id: "2" } }, { status: 201 });
  };
  const output = { out: (line: string) => lines.push(line), err: (line: string) => lines.push(line) };
  expect(await runCli(["tasks", "create", "2"], env, { fetch, output })).toBe(0);
  expect(bodies).toEqual([{ re: "2" }]);
  expect(lines).toEqual(["2"]);
});

test.each([[[]], [["dev"]], [["dev", "a", "b"]]])("ob tasks create %j is a misuse, sent nowhere", async (args) => {
  const lines: string[] = [];
  const fetch = async () => {
    throw new Error("nothing should be sent");
  };
  const output = { out: (line: string) => lines.push(line), err: (line: string) => lines.push(line) };
  expect(await runCli(["tasks", "create", ...args], ENV, { fetch, output })).toBe(2);
  expect(lines[0]).toStartWith("error: invalid_request: expected <channel> <text>, or <re>: ob tasks create");
});

const ENV = { BOARD_URL: "http://127.0.0.1:8787/api/local/main" };

function root(id: string, text: string, labels: Record<string, string>) {
  return { id, text, labels: { ...labels, "board.task": "ready" }, task: { state: "ready" } };
}

async function tasks(args: readonly string[], answer: unknown) {
  const lines: string[] = [];
  const urls: string[] = [];
  const fetch = async (request: Request) => {
    urls.push(request.url);
    return Response.json(answer);
  };
  const output = { out: (line: string) => lines.push(line), err: (line: string) => lines.push(line) };
  expect(await runCli(["tasks", ...args], ENV, { fetch, output })).toBe(0);
  return { lines, urls };
}

test("ob tasks prints one row per task: ID, state, first line, labels", async () => {
  const page = {
    tasks: [
      { message: root("2", "a\nmore", {}), replies: 1, last: { id: "4", text: "started" } },
      { message: root("3", "b", { k: "v" }), replies: 0, last: null },
    ],
    cursor: "4",
  };
  const { lines, urls } = await tasks(["dev", "--label", "k=v", "--state", "ready"], page);
  expect(urls).toEqual([`${ENV.BOARD_URL}/tasks?label=k%3Dv&state=ready&channel=dev`]);
  expect(lines).toEqual(["#2  ready  a …\n#3  ready  b  k=v"]);
});

test("ob tasks on a full page prints the command that reads the next one", async () => {
  const page = { tasks: [{ message: root("2", "a", {}), replies: 0, last: null }], cursor: "2" };
  const { lines } = await tasks(["dev/", "--limit", "1"], page);
  expect(lines).toEqual(["#2  ready  a\n(more not shown: ob tasks dev/ --limit 1 --after 2)"]);
  const everywhere = await tasks(["--state", "all", "--limit", "1"], page);
  expect(everywhere.lines.at(-1)).toEndWith("(more not shown: ob tasks --state all --limit 1 --after 2)");
});

test("ob tasks preserves the prerequisite filter on the next page", async () => {
  const page = { tasks: [{ message: root("5", "a", {}), replies: 0, last: null }], cursor: "5" };
  const { lines, urls } = await tasks(["dev/", "--needs", "2", "--limit", "1"], page);
  expect(urls).toEqual([`${ENV.BOARD_URL}/tasks?needs=2&limit=1&channel=dev%2F`]);
  expect(lines).toEqual(["#5  ready  a\n(more not shown: ob tasks dev/ --needs 2 --limit 1 --after 5)"]);
});

test("ob tasks says when no task matches", async () => {
  expect((await tasks(["dev"], { tasks: [], cursor: "9" })).lines).toEqual(["no open tasks in dev"]);
  expect((await tasks(["--state", "all"], { tasks: [], cursor: "9" })).lines).toEqual(["no tasks"]);
});

test.each([
  ["complete", "completed"],
  ["complete", "claim_lost"],
  ["release", "released"],
  ["fail", "failed"],
] as const)("ob tasks %s forgets a claim after %s", async (command, outcome) => {
  const home = mkdtempSync(join(tmpdir(), "ob-settle-"));
  const key = { boardUrl: ENV.BOARD_URL, actor: "agent-a", id: "2" };
  const claim = { epoch: 2, token: "test claim credential", until: "2023-11-14T22:28:20.000Z" };
  const other = { ...key, actor: "agent-b" };
  const path = join(home, ".config", "openboard", "claims.json");
  const lines: string[] = [];
  const output = { out: (line: string) => lines.push(line), err: (line: string) => lines.push(line) };
  const text = command === "complete" ? "fixed in a1b2c3" : command === "fail" ? "no access" : undefined;
  const run = (accepted: boolean) =>
    runCli(
      ["tasks", command, "2", ...(text === undefined ? [] : [text])],
      { ...ENV, HOME: home },
      {
        output,
        fetch: async (request) => {
          if (request.url === `${ENV.BOARD_URL}/me`) return Response.json({ actor: key.actor });
          expect(request.url).toBe(`${ENV.BOARD_URL}/tasks/2/${command}`);
          expect(await request.json()).toEqual({
            epoch: claim.epoch,
            token: claim.token,
            ...(text === undefined ? {} : { [command === "fail" ? "reason" : "result"]: text }),
          });
          return accepted
            ? outcome !== "claim_lost"
              ? Response.json({ task: { id: "2" } })
              : Response.json({ error: { code: "claim_lost", message: "claim expired" } }, { status: 409 })
            : Response.json({ error: { code: "unavailable", message: "retry" } }, { status: 503 });
        },
      },
    );
  try {
    for (const entryKey of [key, other]) {
      await withClaimStorage(home, async () => ({ result: null, entry: { key: entryKey, claim } }));
    }
    expect(await run(false)).toBe(1);
    expect(await run(true)).toBe(outcome !== "claim_lost" ? 0 : 1);
    expect(lines).toEqual([
      "error: unavailable: retry",
      outcome !== "claim_lost" ? `${outcome} 2` : "error: claim_lost: claim expired",
    ]);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      [JSON.stringify([other.boardUrl, other.actor, other.id])]: claim,
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("ob tasks cancel sends the reason as the chosen profile and prints the task ID", async () => {
  const lines: string[] = [];
  const fetch = async (request: Request) => {
    expect(`${request.method} ${request.url}`).toBe(`POST ${ENV.BOARD_URL}/tasks/2/cancel`);
    expect(request.headers.get("x-board-profile")).toBe("fixer-1");
    expect(await request.json()).toEqual({ reason: "not needed" });
    return Response.json({ task: { id: "2" } });
  };
  const output = { out: (line: string) => lines.push(line), err: (line: string) => lines.push(line) };
  const args = ["tasks", "cancel", "2", "not needed", "--as", "fixer-1"];
  expect(await runCli(args, ENV, { fetch, output })).toBe(0);
  expect(lines).toEqual(["canceled 2"]);
});

test("ob tasks cancel reports its JSON outcome and clears only the caller's saved claim on success", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-cancel-"));
  const key = { boardUrl: ENV.BOARD_URL, actor: "agent-a", id: "2" };
  const other = { ...key, actor: "agent-b" };
  const claim = { epoch: 2, token: "test claim credential", until: "2023-11-14T22:28:20.000Z" };
  const path = join(home, ".config", "openboard", "claims.json");
  const lines: string[] = [];
  const output = { out: (line: string) => lines.push(line), err: (line: string) => lines.push(line) };
  const run = (accepted: boolean) =>
    runCli(
      ["tasks", "cancel", "2", "not needed", "--json"],
      { ...ENV, HOME: home },
      {
        output,
        fetch: async (request) => {
          if (request.url === `${ENV.BOARD_URL}/me`) return Response.json({ actor: key.actor });
          expect(request.url).toBe(`${ENV.BOARD_URL}/tasks/2/cancel`);
          expect(await request.json()).toEqual({ reason: "not needed" });
          return accepted
            ? Response.json({ task: { id: "2" } })
            : Response.json({ error: { code: "unavailable", message: "retry" } }, { status: 503 });
        },
      },
    );
  const storedKey = ({ boardUrl, actor, id }: typeof key) => JSON.stringify([boardUrl, actor, id]);
  try {
    for (const entryKey of [key, other]) {
      await withClaimStorage(home, async () => ({ result: null, entry: { key: entryKey, claim } }));
    }
    expect(await run(false)).toBe(1);
    expect(lines.shift()).toBe("error: unavailable: retry");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ [storedKey(key)]: claim, [storedKey(other)]: claim });
    expect(await run(true)).toBe(0);
    expect(JSON.parse(lines[0] ?? "")).toEqual({ task: { id: "2" }, outcome: "canceled" });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ [storedKey(other)]: claim });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("ob tasks cancel succeeds when the local claim cache cannot be opened", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-cancel-"));
  const lines: string[] = [];
  try {
    writeFileSync(join(home, ".config"), "");
    const output = { out: (line: string) => lines.push(line), err: (line: string) => lines.push(line) };
    const fetch = async (request: Request) => {
      if (request.url === `${ENV.BOARD_URL}/me`) return Response.json({ actor: "agent-a" });
      expect(request.url).toBe(`${ENV.BOARD_URL}/tasks/2/cancel`);
      return Response.json({ task: { id: "2" } });
    };
    expect(await runCli(["tasks", "cancel", "2", "no"], { ...ENV, HOME: home }, { fetch, output })).toBe(0);
    expect(lines).toEqual(["canceled 2"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test.each([
  ["reopened", "reopened 2"],
  ["unchanged", "unchanged"],
])("ob tasks reopen prints %s outcomes", async (outcome, expected) => {
  const result = { task: { id: "2" }, outcome };
  const lines: string[] = [];
  const fetch = async (request: Request) => {
    expect(`${request.method} ${request.url}`).toBe(`POST ${ENV.BOARD_URL}/tasks/2/reopen`);
    expect(request.body).toBeNull();
    return Response.json(result);
  };
  const output = { out: (line: string) => lines.push(line), err: (line: string) => lines.push(line) };
  expect(await runCli(["tasks", "reopen", "2"], ENV, { fetch, output })).toBe(0);
  expect(await runCli(["tasks", "reopen", "2", "--json"], ENV, { fetch, output })).toBe(0);
  expect(lines[0]).toBe(expected);
  expect(JSON.parse(lines[1] ?? "")).toEqual(result);
});

test("ob tasks --latest sends the flag and omits the continuation on a full page", async () => {
  const page = { tasks: [{ message: root("2", "a", {}), replies: 0, last: null }], cursor: "9" };
  const { lines, urls } = await tasks(["dev", "--latest", "--limit", "1"], page);
  expect(urls).toEqual([`${ENV.BOARD_URL}/tasks?latest=true&limit=1&channel=dev`]);
  expect(lines).toEqual(["#2  ready  a"]);
});
