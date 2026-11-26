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

describe("ob connections create --claims", () => {
  test("sends --claims as a number, and refuses one that is not a positive whole number before asking", async () => {
    const fake = board(201, created);
    const { lines, output } = capture();
    const argv = ["connections", "create", "sandbox", "--can", "dev/=post", "--claims"];
    const file = ["--secret-file", join(dir, "sandbox.secret")];
    expect(await runCli([...argv, "1", ...file], env, { fetch: fake.fetch, output })).toBe(0);
    expect(fake.seen[0]?.body).toEqual({ name: "sandbox", can: { "dev/": ["post"] }, direct: false, claims: 1 });
    expect(await runCli([...argv, "0", ...file], env, { fetch: fake.fetch, output })).toBe(2);
    expect(fake.seen).toHaveLength(1);
    expect(lines.err.join("\n")).toContain("--claims takes a positive whole number");
  });
});

describe("ob connections rotate", () => {
  const rotated = { ...created, previousUntil: "2023-11-14T22:23:20.000Z" };

  test("writes the new secret to a 0600 file and says until when the old one works, never printing it", async () => {
    const file = join(dir, "new.secret");
    const fake = board(200, rotated);
    const { lines, output } = capture();
    const argv = ["connections", "rotate", connection.id, "--overlap", "10m", "--secret-file", file];
    expect(await runCli(argv, env, { fetch: fake.fetch, output })).toBe(0);
    expect(fake.seen).toEqual([
      { url: `${BOARD_URL}/x/connections/${connection.id}/rotate`, body: { overlap: "10m" } },
    ]);
    expect(readFileSync(file, "utf8")).toBe(`${secret}\n`);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(lines.out).toEqual([
      "rotated connection laptop",
      `id         ${connection.id}`,
      "old secret works until 2023-11-14T22:23:20.000Z",
      `secret     written to ${file} (mode 0600)`,
    ]);
    expect([...lines.out, ...lines.err].join("\n")).not.toContain(secret);
  });

  test("sends no overlap when none is given, and leaves the secret out of --json", async () => {
    const file = join(dir, "new.secret");
    const fake = board(200, { ...rotated, previousUntil: null });
    const { lines, output } = capture();
    const argv = ["connections", "rotate", connection.id, "--secret-file", file, "--json"];
    expect(await runCli(argv, env, { fetch: fake.fetch, output })).toBe(0);
    expect(fake.seen[0]?.body).toEqual({});
    expect(JSON.parse(lines.out.join("\n"))).toEqual({ connection, previousUntil: null, secretFile: file });
  });

  test("removes the secret file when the board refuses", async () => {
    const file = join(dir, "new.secret");
    const fake = board(400, { error: { code: "invalid_request", message: "overlap 25h is longer than 24 hours" } });
    const { lines, output } = capture();
    const argv = ["connections", "rotate", connection.id, "--overlap", "25h", "--secret-file", file];
    expect(await runCli(argv, env, { fetch: fake.fetch, output })).toBe(1);
    expect(existsSync(file)).toBe(false);
    expect(lines.err).toEqual(["error: invalid_request: overlap 25h is longer than 24 hours"]);
  });

  test("says the board may have rotated anyway when its answer is lost", async () => {
    const file = join(dir, "new.secret");
    const fetch = async () => new Response("<html>bad gateway</html>", { status: 200 });
    const { lines, output } = capture();
    const argv = ["connections", "rotate", connection.id, "--overlap", "10m", "--secret-file", file];
    expect(await runCli(argv, env, { fetch, output })).toBe(1);
    expect(existsSync(file)).toBe(false);
    expect(lines.err[0]).toBe(
      `the board may have rotated ${connection.id} without answering its new secret: rotate it again`,
    );
  });

  test.each([
    [[connection.id], "--secret-file is required"],
    [["--secret-file", "x"], "expected 1 argument"],
    [[connection.id, "--overlap"], "--overlap takes a value"],
    [[connection.id, "--secret", "x"], "unknown option --secret"],
  ])("exits 2 on %j", async (args, problem) => {
    const { lines, output } = capture();
    expect(await runCli(["connections", "rotate", ...args], env, { output })).toBe(2);
    expect(lines.err[0]).toContain(problem);
  });
});

describe("ob connections", () => {
  const agent = {
    id: `ag_${"c".repeat(16)}`,
    actor: `ob:conn:${connection.id}+fixer-2`,
    can: { "*": ["read"] },
    expiresAt: "2023-11-14T23:14:20.000Z",
    hardExpiresAt: "2023-11-15T22:14:20.000Z",
    profile: "fixer-2",
    createdAt: "2023-11-14T22:14:20.000Z",
  };
  const listed = {
    ...connection,
    principal: `ob:conn:${connection.id}`,
    can: { "*": ["read"] },
    direct: false,
    profiles: ["*"],
    secretHint: "…bbbb",
    createdBy: "ob:user:local-test",
    createdAt: "2023-11-14T22:13:20.000Z",
  };

  test("lists each connection with its agents, last use and secret hint", async () => {
    const used = { ...listed, lastUsedAt: "2023-11-14T22:14:20.000Z", agents: [agent] };
    const idle = { ...listed, id: `cn_${"d".repeat(16)}`, name: "spare", lastUsedAt: null, agents: [] };
    const requests: string[] = [];
    const fetch = async (request: Request) => {
      requests.push(`${request.method} ${request.url}`);
      return Response.json({ connections: [used, idle] });
    };
    const { lines, output } = capture();
    expect(await runCli(["connections"], env, { fetch, output })).toBe(0);
    expect(requests).toEqual([`GET ${BOARD_URL}/x/connections`]);
    expect(lines.out.join("\n").split("\n")).toEqual([
      `laptop  ${connection.id}  secret …bbbb  last used 2023-11-14T22:14:20.000Z`,
      `  agent ${agent.id}  fixer-2  expires 2023-11-14T23:14:20.000Z`,
      `spare  ${idle.id}  secret …bbbb  last used never`,
      "  no agents",
    ]);
  });

  test("shows one connection, and says so when the board has none", async () => {
    const one = async () => Response.json({ connection: { ...listed, lastUsedAt: null, agents: [] } });
    const shown = capture();
    expect(await runCli(["connections", "show", connection.id], env, { fetch: one, output: shown.output })).toBe(0);
    expect(shown.lines.out.join("\n")).toBe(`laptop  ${connection.id}  secret …bbbb  last used never\n  no agents`);
    const none = capture();
    const empty = async () => Response.json({ connections: [] });
    expect(await runCli(["connections"], env, { fetch: empty, output: none.output })).toBe(0);
    expect(none.lines.out).toEqual(["no connections"]);
  });
});

test("ob connections policy passes --as and --can as policy query parameters", async () => {
  const { lines, output } = capture();
  const policy = { env: { BOARD_URL, BOARD_TOKEN: "<placeholder>", BOARD_PROFILE: "fixer-2" } };
  const fetch = async (request: Request) => {
    const url = new URL(request.url);
    expect(request.method).toBe("GET");
    expect(url.pathname).toBe(`/api/local/main/x/connections/${connection.id}/policy`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ profile: "fixer-2", can: "work/fix/=read,post" });
    return Response.json(policy);
  };
  const argv = ["connections", "policy", connection.id, "--as", "fixer-2", "--can", "work/fix/=read,post"];
  expect(await runCli(argv, env, { fetch, output })).toBe(0);
  expect(JSON.parse(lines.out.join("\n"))).toEqual(policy);
});

test("ob connections policy advertises both required pins and rejects a missing pin", async () => {
  const { lines, output } = capture();
  const command = ["connections", "policy"];
  const usage = "ob connections policy <id> --as <as> --can <can>";
  expect(await runCli([...command, "--help"], env, { output })).toBe(0);
  expect(lines.out[0]).toBe(usage);
  expect(await runCli([...command, connection.id, "--as", "fixer-2"], env, { output })).toBe(2);
  expect(lines.err[0]).toContain("policy requires --as and --can");
});

test.each(["show", "revoke", "rotate"])("ob connections %s resolves an exact name to an ID", async (command) => {
  const requests: string[] = [];
  const file = join(dir, "new.secret");
  const { lines, output } = capture();
  const fetch = async (request: Request) => {
    const path = request.url.slice(BOARD_URL.length);
    requests.push(`${request.method} ${path}`);
    if (path === "/x/connections") {
      return Response.json({ connections: [{ name: "laptop-spare", id: "cn_spare" }, connection] });
    }
    return Response.json({ ...created, id: connection.id, revokedAt: "now", previousUntil: null });
  };
  const options = command === "rotate" ? ["--secret-file", file] : [];
  expect(await runCli(["connections", command, connection.name, "--json", ...options], env, { fetch, output })).toBe(0);
  expect(requests).toEqual([
    "GET /x/connections",
    command === "show" ? `GET /x/connections/${connection.id}` : `POST /x/connections/${connection.id}/${command}`,
  ]);
  expect(JSON.parse(lines.out.join("\n"))).toMatchObject(command === "revoke" ? { id: connection.id } : { connection });
});

test("ob connections revoke reports an unknown name without attempting revocation", async () => {
  const { lines, output } = capture();
  const fetch = async (request: Request) => {
    expect(request.url).toBe(`${BOARD_URL}/x/connections`);
    expect(request.method).toBe("GET");
    return Response.json({ connections: [connection] });
  };
  expect(await runCli(["connections", "revoke", "lap"], env, { fetch, output })).toBe(1);
  expect(lines.err[0]).toBe("error: not_found: No active connection named lap on this board.");
});
