import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { createConnection, createTask, OutputOf } from "@openboard/contract";
import { runCli } from "../../packages/cli/src/main.ts";
import { BOARD_URL, call, makeApp, NOW } from "../../packages/server/test/support/app.ts";

type App = ReturnType<typeof makeApp>;

async function firstSteps() {
  const markdown = await Bun.file(new URL("../../skills/openboard/SKILL.md", import.meta.url)).text();
  const section = markdown.split(/^## First steps\r?$/m)[1]?.split(/^## /m)[0];
  if (!section) throw new Error("First steps section is missing");
  const commands = [...section.matchAll(/^```sh\r?\n([\s\S]*?)^```\r?$/gm)].flatMap(([, block]) =>
    (block ?? "").trim().split(/\r?\n/),
  );
  return { section, commands };
}

async function seed(app: App, writable: boolean) {
  const connection = await call(app, "POST", "/x/connections", {
    name: "onboarding",
    direct: writable,
    can: { dev: writable ? ["read", "post", "label"] : ["read"] },
  });
  expect(connection.status).toBe(201);
  const { secret } = (await connection.json()) as OutputOf<typeof createConnection>;

  const task = { channel: "dev", text: "Fix the build" };
  // A ready task belongs to the connection's pool. Seed it as that principal for the writable journey.
  const response = writable
    ? await app.fetch(
        new Request(`${BOARD_URL}/tasks`, {
          method: "POST",
          headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
          body: JSON.stringify(task),
        }),
      )
    : await call(app, "POST", "/tasks", task);
  expect(response.status).toBe(201);
  const {
    task: { id },
  } = (await response.json()) as OutputOf<typeof createTask>;
  return { secret, id };
}

async function walkthrough(writable: boolean) {
  const { section, commands } = await firstSteps();
  const home = mkdtempSync(join(tmpdir(), "ob-onboarding-"));
  const app = makeApp();
  try {
    const { secret, id } = await seed(app, writable);
    const transcript = [];
    let taskId: string | undefined;
    for (const command of commands) {
      // The walkthrough uses one ob invocation per line and only one stdin redirection.
      const stdin = command.endsWith(' < "$secret_path"');
      const invocation = stdin ? command.slice(0, -' < "$secret_path"'.length) : command;
      const words = [...invocation.matchAll(/"([^"]*)"|([^\s"]+)/g)].map(([, quoted, bare]) => quoted ?? bare ?? "");
      expect(words.shift()).toBe("ob");
      const args = words.map((word) => {
        if (word === "$BOARD_URL") return BOARD_URL;
        if (word === "$task_id" && taskId) return taskId;
        if (word.startsWith("$")) throw new Error(`Unresolved walkthrough variable ${word}`);
        return word;
      });
      const out: string[] = [];
      const err: string[] = [];
      const code = await runCli(
        args,
        { HOME: home, BOARD_URL },
        {
          fetch: app.fetch,
          now: () => NOW,
          ...(stdin && { readStdin: () => `${secret}\n` }),
          output: { out: (line) => out.push(line), err: (line) => err.push(line) },
        },
      );
      transcript.push({
        step: args.slice(0, args[0] === "tasks" || args[0] === "grants" ? 2 : 1).join(" "),
        code,
        out,
        err,
      });
      if (code !== 0) break;
      if (args[0] === "tasks" && args[1] === "claim") taskId = /^#(\d+)\s/.exec(out[0] ?? "")?.[1];
    }
    return { section, transcript, id };
  } finally {
    await app.close();
    rmSync(home, { recursive: true, force: true });
  }
}

test("First steps reads with a read-only grant and the first write names the missing permission", async () => {
  const { section, transcript } = await walkthrough(false);
  expect(transcript.map(({ step, code }) => [step, code])).toEqual([
    ["connect", 0],
    ["whoami", 0],
    ["grants explain", 0],
    ["read", 0],
    ["tasks claim", 1],
  ]);
  expect(transcript[1]?.out.join("\n")).toContain("fixer-2 via onboarding (credential: agent)");
  expect(transcript[2]?.out.join("\n")).toMatch(/\bread\./);
  expect(transcript[3]?.out.join("\n")).toContain("Fix the build");
  expect(transcript[4]?.err[0]).toBe("error: forbidden: this token was claimed without label in dev");
  expect(section).toMatch(/stop and ask\s+the board owner for the permission named in the error/);
});

test("First steps claims, replies and completes with read, post and label", async () => {
  const { transcript, id } = await walkthrough(true);
  expect(transcript.map(({ step, code }) => [step, code])).toEqual([
    ["connect", 0],
    ["whoami", 0],
    ["grants explain", 0],
    ["read", 0],
    ["tasks claim", 0],
    ["read", 0],
    ["reply", 0],
    ["tasks complete", 0],
  ]);
  expect(transcript[4]?.out[0]).toStartWith(`#${id}  yours for `);
  expect(transcript[5]?.out.join("\n")).toContain("Fix the build");
  expect(transcript[6]?.out[0]).toMatch(/^\d+$/);
  expect(transcript[6]?.out[0]).not.toBe(id);
  expect(transcript[7]?.out).toEqual([`completed ${id}`]);
});
