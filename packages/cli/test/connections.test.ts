import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/main.ts";

const BOARD_URL = "http://127.0.0.1:8787/api/local/main";
const env = { BOARD_URL };
/** Built at run time, so no token-shaped string sits in the source. */
const secret = ["obc", "a".repeat(16), "b".repeat(43)].join("_");
const connection = { id: `cn_${"a".repeat(16)}`, name: "laptop", grant: "g4" };

function board(status: number, body: unknown) {
  const seen: { url: string; body: unknown }[] = [];
  const fetch = async (request: Request) => {
    seen.push({ url: request.url, body: await request.json() });
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

const created = { connection, secret, env: { BOARD_URL, BOARD_TOKEN: secret } };
let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ob-connections-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("ob connections create", () => {
  test("writes the secret to a 0600 file and prints the ID and BOARD_URL, never the secret", async () => {
    const file = join(dir, "laptop.secret");
    const fake = board(201, created);
    const { lines, output } = capture();
    const argv = ["connections", "create", "laptop", "--direct", "--can", "*=all", "--secret-file", file];
    expect(await runCli(argv, env, { fetch: fake.fetch, output })).toBe(0);
    expect(fake.seen).toEqual([
      { url: `${BOARD_URL}/x/connections`, body: { name: "laptop", can: { "*": "all" }, direct: true } },
    ]);
    expect(readFileSync(file, "utf8")).toBe(`${secret}\n`);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(lines.out).toEqual([
      "created connection laptop",
      `id         ${connection.id}`,
      `BOARD_URL  ${BOARD_URL}`,
      `secret     written to ${file} (mode 0600)`,
    ]);
    expect([...lines.out, ...lines.err].join("\n")).not.toContain(secret);
  });

  test("leaves the secret out of --json and sends each --can pattern", async () => {
    const file = join(dir, "ci.secret");
    const fake = board(201, created);
    const { lines, output } = capture();
    const argv = ["connections", "create", "ci", "--can", "dev/=read,post", "--can", "ops=all", "--secret-file", file];
    expect(await runCli([...argv, "--json"], env, { fetch: fake.fetch, output })).toBe(0);
    expect(fake.seen[0]?.body).toEqual({ name: "ci", can: { "dev/": ["read", "post"], ops: "all" }, direct: false });
    expect(JSON.parse(lines.out.join("\n"))).toEqual({ connection, env: { BOARD_URL }, secretFile: file });
  });

  test("sends the profile patterns --profiles names, comma-separated or repeated", async () => {
    const fake = board(201, created);
    const { output } = capture();
    const argv = ["connections", "create", "fixers", "--can", "dev/=post", "--profiles", "fixer-*,ci"];
    const more = ["--profiles", "bot", "--secret-file", join(dir, "fixers.secret")];
    expect(await runCli([...argv, ...more], env, { fetch: fake.fetch, output })).toBe(0);
    expect(fake.seen[0]?.body).toEqual({
      name: "fixers",
      can: { "dev/": ["post"] },
      direct: false,
      profiles: ["fixer-*", "ci", "bot"],
    });
  });

  test("refuses an existing secret file before asking the board", async () => {
    const file = join(dir, "laptop.secret");
    writeFileSync(file, "keep me");
    const fake = board(201, created);
    const { lines, output } = capture();
    const argv = ["connections", "create", "laptop", "--can", "*=all", "--secret-file", file];
    expect(await runCli(argv, env, { fetch: fake.fetch, output })).toBe(2);
    expect(fake.seen).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe("keep me");
    expect(lines.err[0]).toContain("already exists");
  });

  test("removes the secret file when the board refuses", async () => {
    const file = join(dir, "laptop.secret");
    const fake = board(409, { error: { code: "slug_taken", message: "a connection named laptop already exists" } });
    const { lines, output } = capture();
    const argv = ["connections", "create", "laptop", "--can", "*=all", "--secret-file", file];
    expect(await runCli(argv, env, { fetch: fake.fetch, output })).toBe(1);
    expect(existsSync(file)).toBe(false);
    expect(lines.err).toEqual(["error: slug_taken: a connection named laptop already exists"]);
  });

  test.each([
    [["laptop", "--can", "*=all"], "--secret-file is required"],
    [["laptop", "--secret-file", "x"], "--can is required"],
    [["laptop", "--can", "*", "--secret-file", "x"], "--can takes pattern=permissions"],
    [["--can", "*=all", "--secret-file", "x"], "expected 1 argument"],
    [["laptop", "--secret", "x"], "unknown option --secret"],
  ])("exits 2 on %j", async (args, problem) => {
    const { lines, output } = capture();
    expect(await runCli(["connections", "create", ...args], env, { output })).toBe(2);
    expect(lines.err[0]).toContain(problem);
  });
});
