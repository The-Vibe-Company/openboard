import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@the-vibe-company/openboard";
import { clientConfig, personalConfigPath, storePersonalLogin } from "../src/config.ts";
import { runCli } from "../src/main.ts";

const origin = "http://127.0.0.1:8787";

test.each([undefined, "dev=read"])(
  "login with can %s prints the browser instructions before polling, then saves and loads a private credential",
  async (can) => {
    const home = mkdtempSync(join(tmpdir(), "ob-login-"));
    const env = { HOME: home };
    const output: string[] = [];
    const errors: string[] = [];
    const token = ["obp", "a".repeat(16), "b".repeat(43)].join("_");
    const deviceCode = "d".repeat(43) + (can === undefined ? "" : "n");
    let clock = 0;
    let polls = 0;
    try {
      const code = await runCli(can === undefined ? ["login", origin] : ["login", origin, "--can", can], env, {
        output: { out: (line) => output.push(line), err: (line) => errors.push(line) },
        now: () => clock,
        wait: async (ms) => {
          expect(output).toEqual([`Open ${origin}/device and enter code ABCD-EFGH-IJKL-MNOP.`]);
          clock += ms;
        },
        fetch: async (request) => {
          expect(request.redirect).toBe("error");
          if (request.url === `${origin}/api/x/auth/device`) {
            expect(await request.json()).toEqual(can === undefined ? { clientName: "ob" } : { clientName: "ob", can });
            return Response.json({
              deviceCode,
              userCode: "ABCD-EFGH-IJKL-MNOP",
              verificationUri: `${origin}/device`,
              interval: 5,
              expiresIn: 600,
            });
          }
          expect(request.url).toBe(`${origin}/api/x/auth/device/token`);
          expect(await request.json()).toEqual({ deviceCode });
          if (++polls === 1) return Response.json({ pending: true });
          return Response.json({
            token,
            org: { slug: "acme", name: "Acme" },
            boards: [{ slug: "main", name: "main", url: `${origin}/api/acme/main` }],
          });
        },
      });
      expect(code).toBe(0);
      expect(errors).toEqual([]);
      expect(clock).toBe(10_000);
      expect(output.at(-1)).toBe("Signed in to acme. Boards: main.");
      const file = join(home, ".config", "openboard", "personal.json");
      expect(statSync(file).mode & 0o777).toBe(0o600);
      const saved = JSON.parse(readFileSync(file, "utf8"));
      expect(saved.token === token).toBe(true);
      expect(clientConfig(env)).toMatchObject({ boardUrl: `${origin}/api/acme/main` });
      expect(clientConfig(env).token === token).toBe(true);
      expect(clientConfig({ ...env, BOARD_URL: "https://other.example/api/acme/main" }).token).toBeUndefined();
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  },
);

test("login rejects an invalid can before making a request", async () => {
  const errors: string[] = [];
  const code = await runCli(
    ["login", origin, "--can", "dev"],
    {},
    {
      output: { out() {}, err: (line) => errors.push(line) },
      fetch: async () => {
        throw new Error("login should not make a request");
      },
    },
  );
  expect(code).toBe(1);
  expect(errors).toEqual(["error: invalid_scope: can must use pattern=permissions (for example, dev=read)"]);
});

test("connecting after login makes the agent active even when both credentials match the board", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-login-connect-"));
  const boardUrl = `${origin}/api/acme/main`;
  const env = { HOME: home, OPENBOARD_SECRET: "connection-fixture" };
  const output = { out() {}, err() {} };
  const agent = ["obt", "a".repeat(16), "b".repeat(43)].join("_");
  const personal = ["obp", "a".repeat(16), "b".repeat(43)].join("_");
  const connect = () =>
    runCli(["connect", boardUrl, "--as", "worker"], env, {
      fetch: async () => Response.json({ token: agent }),
      output,
    });
  try {
    expect(await connect()).toBe(0);
    utimesSync(join(home, ".config", "openboard", "agent.json"), 1, 1);
    const path = personalConfigPath(env);
    if (!path) throw new Error("missing personal path");
    await storePersonalLogin(path, async () => ({
      credential: { origin, org: "acme", board: "main", token: personal },
      result: undefined,
    }));
    expect(clientConfig(env).token === personal).toBe(true);
    utimesSync(path, 1, 1);
    expect(await connect()).toBe(0);
    expect(clientConfig(env).token === agent).toBe(true);
    expect(clientConfig({ ...env, BOARD_URL: boardUrl }).profile).toBe("worker");
  } finally {
    rmSync(home, { force: true, recursive: true });
  }
});

test("a bodyless account write sends the configured CSRF proof", async () => {
  const id = `pt_${"a".repeat(16)}`;
  const result = { id, revokedAt: 1_700_000_000_000 };
  const origin = "https://openboard.example";
  const client = createClient({
    url: `${origin}/api/acme/main`,
    csrf: "example-csrf",
    fetch: async (request) => {
      expect(request.method).toBe("POST");
      expect(request.url).toBe(`${origin}/api/x/tokens/${id}/revoke`);
      expect(request.headers.get("x-ob-csrf")).toBe("example-csrf");
      expect(request.body).toBeNull();
      return Response.json(result);
    },
  });

  expect(await client.revokePersonalToken({ id })).toEqual(result);
});
