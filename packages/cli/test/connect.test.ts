import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { clientConfig } from "../src/config.ts";
import { runCli } from "../src/main.ts";

const url = "http://127.0.0.1:8787/api/local/main";
const secret = "connection-placeholder";
const token = ["obt", "a".repeat(16), "b".repeat(43)].join("_");
const profile = "fixer-2";

async function setup(run: (home: string, path: string) => Promise<void>): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "ob-connect-"));
  try {
    await run(home, join(home, ".config", "openboard", "agent.json"));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, output: { out: (line: string) => out.push(line), err: (line: string) => err.push(line) } };
}

test.each(["stdin", "env", "file", "env file"])("connect claims with %s and whoami uses the saved agent", (source) =>
  setup(async (home, path) => {
    const connectionFile = join(home, "fixers.secret");
    writeFileSync(connectionFile, `${secret}\n`, { mode: 0o600 });
    const env = { HOME: home };
    const captureOutput = capture();
    const fetch = async (request: Request) => {
      if (request.method === "POST") {
        expect(request.url).toBe(`${url}/x/connections/claim`);
        expect(request.redirect).toBe("error");
        expect(request.headers.get("authorization")).toBe(`Bearer ${secret}`);
        expect(request.headers.get("x-board-profile")).toBeNull();
        expect(await request.json()).toEqual({ profile });
        return Response.json({ token });
      }
      expect(request.url).toBe(`${url}/me`);
      expect(request.headers.get("authorization")).toBe(`Bearer ${token}`);
      expect(request.headers.get("x-board-profile")).toBe(profile);
      return Response.json({
        handle: `fixers/${profile}`,
        name: profile,
        openboard: { credential: "agent", role: null, org: { slug: "local" }, board: { slug: "main" } },
      });
    };
    const options = {
      fetch,
      output: captureOutput.output,
      readStdin: () => {
        expect(source).toBe("stdin");
        return `${secret}\r\n`;
      },
    };
    const connectEnv = {
      ...env,
      ...(source === "env" ? { OPENBOARD_SECRET: secret } : {}),
      ...(source === "env file" ? { OPENBOARD_SECRET_FILE: connectionFile } : {}),
    };
    const flags = source === "file" ? ["--secret-file", connectionFile] : [];
    expect(await runCli(["connect", url, "--as", profile, "--json", ...flags], connectEnv, options)).toBe(0);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ boardUrl: url, token, profile });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(await runCli(["whoami"], env, options)).toBe(0);
    expect(captureOutput.out[1]).toBe("fixer-2 via fixers (credential: agent)");
    expect(captureOutput.out.join("\n")).not.toContain(secret);
    expect(captureOutput.out.join("\n")).not.toContain(token);
    expect(captureOutput.err).toEqual([]);
    expect(clientConfig({ ...env, BOARD_URL: `${url}/` }).token).toBe(token);
    expect(clientConfig({ ...env, BOARD_URL: `${url}-other` }).token).toBeUndefined();
    expect(clientConfig({ ...env, BOARD_TOKEN: "explicit" }).boardUrl).toBeUndefined();
    expect(clientConfig({ ...env, BOARD_URL: url, BOARD_TOKEN: "explicit" })).toEqual({
      boardUrl: url,
      token: "explicit",
      profile: undefined,
    });
  }),
);

test("a refused claim keeps the saved agent and does not echo the secret", () =>
  setup(async (home, path) => {
    const { output, err } = capture();
    const env = { HOME: home, OPENBOARD_SECRET: secret };
    const args = ["connect", url, "--as", profile];
    expect(await runCli(args, env, { output, fetch: async () => Response.json({ token }) })).toBe(0);
    const saved = readFileSync(path, "utf8");
    const fetch = async () =>
      Response.json({ error: { code: "unauthorized", message: "rejected", hint: secret } }, { status: 401 });
    expect(await runCli(args, env, { output, fetch })).toBe(1);
    expect(err).toEqual(["error: unauthorized: rejected"]);
    expect(readFileSync(path, "utf8")).toBe(saved);
  }));

test("connect rejects a secret passed as an extra argument before any request", () =>
  setup(async (home) => {
    const { output, err } = capture();
    const fetch = async () => {
      throw new Error("unexpected request");
    };
    const args = ["connect", url, "--as", profile, secret];
    expect(await runCli(args, { HOME: home }, { output, fetch })).toBe(2);
    expect(err[0]).toStartWith("error: invalid_request: connect takes one board URL");
    expect(err.join("\n")).not.toContain(secret);
  }));

test("the local board alias selects the saved agent without falling back to the owner across hostnames", () =>
  setup(async (home, path) => {
    const { output } = capture();
    const env = { HOME: home, OPENBOARD_SECRET: secret };
    const fetch = async () => Response.json({ token });
    expect(await runCli(["connect", url, "--as", profile], env, { output, fetch })).toBe(0);
    const local = join(dirname(path), "local");
    mkdirSync(local);
    writeFileSync(join(local, "8787.json"), JSON.stringify({ token: "local-owner-placeholder" }));
    expect(clientConfig({ ...env, BOARD_URL: "http://127.0.0.1:8787/api" }).token).toBe(token);
    expect(clientConfig({ ...env, BOARD_URL: "http://localhost:8787/api" }).token).toBeUndefined();
  }));

test.each(["http://example.test/api/local/main", `${url}?`, `${url}#`])(
  "connect rejects an unsafe board address (%s) before any request",
  (address) =>
    setup(async (home) => {
      const { output, err } = capture();
      const fetch = async () => {
        throw new Error("unexpected request");
      };
      const args = ["connect", address, "--as", profile];
      expect(await runCli(args, { HOME: home, OPENBOARD_SECRET: secret }, { output, fetch })).toBe(2);
      expect(err[0]).toStartWith("error: invalid_request: connect requires a board URL");
    }),
);

test("connect checks the credential destination before claiming", () =>
  setup(async (home, path) => {
    mkdirSync(path, { recursive: true });
    const { output, err } = capture();
    const fetch = async () => {
      throw new Error("unexpected request");
    };
    const args = ["connect", url, "--as", profile];
    expect(await runCli(args, { HOME: home, OPENBOARD_SECRET: secret }, { output, fetch })).toBe(1);
    expect(err).toEqual(["error: invalid_request: could not prepare agent credential storage"]);
  }));

test.each([
  [{ token: "not-an-agent-token" }, 200],
  [null, 400],
] as const)("a malformed claim response (%j, %d) leaves the saved credential in place", (response, status) =>
  setup(async (home, path) => {
    const { output, err } = capture();
    const env = { HOME: home, OPENBOARD_SECRET: secret };
    const args = ["connect", url, "--as", profile];
    expect(await runCli(args, env, { output, fetch: async () => Response.json({ token }) })).toBe(0);
    const saved = readFileSync(path, "utf8");
    const fetch = async () => Response.json(response, { status });
    expect(await runCli(args, env, { output, fetch })).toBe(1);
    expect(err[0]).toStartWith("error: remote_error:");
    expect(readFileSync(path, "utf8")).toBe(saved);
  }),
);
