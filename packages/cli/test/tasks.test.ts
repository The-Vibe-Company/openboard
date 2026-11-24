import { expect, test } from "bun:test";
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
    });
    return Response.json({ task: { id: "2" } }, { status: 201 });
  };
  const args = ["tasks", "create", "dev", "fix the build", "--label", "repo=web", "--no-sync"];
  expect(
    await runCli(args, env, { fetch, output: { out: (line) => lines.push(line), err: (line) => lines.push(line) } }),
  ).toBe(0);
  expect(lines).toEqual(["2"]);
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

test("ob tasks says when no task matches", async () => {
  expect((await tasks(["dev"], { tasks: [], cursor: "9" })).lines).toEqual(["no open tasks in dev"]);
  expect((await tasks(["--state", "all"], { tasks: [], cursor: "9" })).lines).toEqual(["no tasks"]);
});
