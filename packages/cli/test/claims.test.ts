import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withClaimStorage } from "../src/claims.ts";
import { runCli } from "../src/main.ts";

test("task claims are stored privately for each actor and task and never printed", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-claims-"));
  const boardUrl = "http://127.0.0.1:8787/api/local/main";
  const lines: string[] = [];
  const output = { out: (line: string) => lines.push(line), err: (line: string) => lines.push(line) };
  const until = "2023-11-14T22:28:20.000Z";
  const token = "test claim credential";
  const env = { HOME: home, BOARD_URL: boardUrl };
  const now = () => Date.parse("2023-11-14T22:13:20.000Z");
  const run = (args: string[], id: string, actor: string, path: string, body: unknown) =>
    runCli(args, env, {
      now,
      output,
      fetch: async (request) => {
        expect(request.url).toBe(boardUrl + path);
        expect(await request.json()).toEqual(body);
        return Response.json({
          task: { id, text: "fix the build", task: { claim: { actor, until } } },
          claim: { epoch: 1, token, until },
        });
      },
    });
  try {
    expect(await run(["tasks", "claim", "2"], "2", "agent-a", "/tasks/2/claim", {})).toBe(0);
    expect(lines).toEqual(["#2  yours for 15m  fix the build"]);
    expect(
      await run(["tasks", "create", "dev", "x", "--claim", "--json"], "5", "agent-b", "/tasks", {
        channel: "dev",
        text: "x",
        claim: true,
      }),
    ).toBe(0);
    expect(JSON.parse(lines[1] ?? "")).toMatchObject({ task: { id: "5" }, claim: { epoch: 1, until } });
    expect(lines.join("\n")).not.toContain(token);
    const file = join(home, ".config", "openboard", "claims.json");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      [JSON.stringify([boardUrl, "agent-a", "2"])]: { epoch: 1, token, until },
      [JSON.stringify([boardUrl, "agent-b", "5"])]: { epoch: 1, token, until },
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a dead CLI owner's lock is reclaimed before obtaining a new claim", async () => {
  const home = mkdtempSync(join(tmpdir(), "ob-claims-"));
  const lock = join(home, ".config", "openboard", "claims.json.lock");
  try {
    mkdirSync(lock, { recursive: true, mode: 0o700 });
    // Above the supported platforms' PID limits, while still accepted by kill(2).
    writeFileSync(join(lock, "owner-2147483647-.claim-lock-orphan"), "", { mode: 0o600 });
    expect(await withClaimStorage(home, async () => ({ result: "obtained" }))).toBe("obtained");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
