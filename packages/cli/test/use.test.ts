import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agentConfigPath,
  clientConfig,
  personalConfigPath,
  storeAgentClaim,
  storePersonalLogin,
} from "../src/config.ts";
import { runCli } from "../src/main.ts";

const origin = "http://127.0.0.1:8787";
const token = ["obp", "a".repeat(16), "b".repeat(43)].join("_");
const boards = new Set(["main", "ops"]);

/** A home signed in to `acme/main`, a board server that knows `acme/main` and `acme/ops`, and captured output. */
async function signedIn(
  run: (env: { HOME: string }, cli: (...argv: string[]) => Promise<number>) => Promise<void>,
  answer?: () => Promise<Response>,
) {
  const home = mkdtempSync(join(tmpdir(), "ob-use-"));
  const env = { HOME: home };
  const lines = { out: [] as string[], err: [] as string[], urls: [] as string[] };
  const fetch = async (request: Request) => {
    lines.urls.push(`${request.method} ${request.url}`);
    if (answer) return answer();
    expect(request.headers.get("authorization") === `Bearer ${token}`).toBe(true);
    const [, org, board] = /^\/api\/([^/]+)\/([^/]+)\//.exec(new URL(request.url).pathname) ?? [];
    if (org !== "acme" || !boards.has(board ?? "")) {
      return Response.json({ error: { code: "not_found", message: "no such board" } }, { status: 404 });
    }
    if (request.method === "POST") return Response.json({ message: { id: "2", text: "hi" } }, { status: 201 });
    return Response.json({ name: "stan", actor: "ob:user:u_1", can: {}, openboard: {} });
  };
  const output = { out: (line: string) => lines.out.push(line), err: (line: string) => lines.err.push(line) };
  const path = personalConfigPath(env);
  if (!path) throw new Error("missing personal path");
  await storePersonalLogin(path, async () => ({
    credential: { origin, org: "acme", board: "main", token },
    result: undefined,
  }));
  try {
    await run(env, (...argv) => runCli(argv, env, { fetch, output }));
    expect(lines.out.join("\n")).not.toContain(token);
    expect(lines.err.join("\n")).not.toContain(token);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
  return lines;
}

test("ob use <board> points later commands at that board of the organization, ob use <org>/<board> back", async () => {
  const lines = await signedIn(async (env, cli) => {
    expect(await cli("use", "ops")).toBe(0);
    expect(await cli("post", "dev", "hi")).toBe(0);
    const path = personalConfigPath(env) ?? "";
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ origin, org: "acme", board: "ops" });
    expect(clientConfig(env).token === token).toBe(true);
    expect(await cli("use", "acme/main", "--json")).toBe(0);
    expect(clientConfig(env).boardUrl).toBe(`${origin}/api/acme/main`);
  });
  expect(lines.err).toEqual([]);
  expect(lines.out).toEqual([
    `Using acme/ops: ${origin}/api/acme/ops`,
    "2",
    JSON.stringify({ org: "acme", board: "main", url: `${origin}/api/acme/main` }),
  ]);
  expect(lines.urls).toEqual([
    `GET ${origin}/api/acme/ops/me`,
    `POST ${origin}/api/acme/ops/messages`,
    `GET ${origin}/api/acme/main/me`,
  ]);
});

test("a board the person cannot reach is refused and the saved board stays", async () => {
  const lines = await signedIn(async (env, cli) => {
    expect(await cli("use", "nope")).toBe(1);
    expect(clientConfig(env).boardUrl).toBe(`${origin}/api/acme/main`);
  });
  expect(lines.err).toEqual(["error: not_found: no board acme/nope you can use"]);
});

test("another organization is refused without asking the board: one organization per person", async () => {
  const lines = await signedIn(async (env, cli) => {
    expect(await cli("use", "other/main")).toBe(1);
    expect(clientConfig(env).boardUrl).toBe(`${origin}/api/acme/main`);
  });
  expect(lines.urls).toEqual([]);
  expect(lines.err).toEqual(["error: invalid_request: you are signed in to acme; boards of other are out of reach"]);
});

test.each([[[]], [["Ops"]], [["a/b/c"]], [["ops", "main"]], [["ops", "--as", "fixer"]]])(
  "ob use %j is a misuse",
  async (args) => {
    const lines = await signedIn(async (_env, cli) => {
      expect(await cli("use", ...args)).toBe(2);
    });
    expect(lines.err[0]).toBe(
      "error: invalid_request: use takes one board slug, or <org>/<board>: ob use <board> | ob use <org>/<board>",
    );
    expect(lines.urls).toEqual([]);
  },
);

test("without a personal sign-in ob use says to log in first", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-use-none-"));
  const err: string[] = [];
  try {
    const code = await runCli(["use", "ops"], { HOME: home }, { output: { out() {}, err: (line) => err.push(line) } });
    expect(code).toBe(1);
    expect(err).toEqual(["error: unauthorized: no personal sign-in: run ob login <origin> first"]);
    expect(existsSync(join(home, ".config"))).toBe(false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test.each([
  [
    "a refused credential",
    async () => Response.json({ error: { code: "unauthorized", message: "no" } }, { status: 401 }),
    "error: unauthorized: the board acme/ops refused the personal credential",
  ],
  [
    "an unreachable board",
    async () => Promise.reject(new TypeError("connection refused")),
    "error: unreachable: could not check the board acme/ops; it stays unchanged",
  ],
])("%s keeps the saved board and its private file", async (_name, answer, message) => {
  const lines = await signedIn(async (env, cli) => {
    const path = personalConfigPath(env) ?? "";
    const before = readFileSync(path, "utf8");
    expect(await cli("use", "ops")).toBe(1);
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  }, answer);
  expect(lines.err).toEqual([message]);
});

test("ob use makes the personal sign-in active over an agent connection saved after it", async () => {
  const agent = ["obt", "a".repeat(16), "b".repeat(43)].join("_");
  await signedIn(async (env, cli) => {
    utimesSync(personalConfigPath(env) ?? "", 1, 1);
    const context = { boardUrl: `${origin}/api/acme/main`, profile: "worker" };
    await storeAgentClaim(agentConfigPath(env) ?? "", context, async () => agent);
    expect(clientConfig(env).token === agent).toBe(true);
    expect(await cli("use", "ops")).toBe(0);
    expect(clientConfig(env).boardUrl).toBe(`${origin}/api/acme/ops`);
    expect(clientConfig(env).token === token).toBe(true);
  });
});
