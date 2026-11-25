import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BOARD_URL, makeApp, OWNER } from "../../../packages/server/test/support/app.ts";
import { createClient } from "../../../packages/sdk/src/index.ts";
import { CHANNEL, runSyncBoard, syncBoard } from "../sync-board.ts";

const apps: ReturnType<typeof makeApp>[] = [];
afterAll(async () => {
  for (const app of apps) await app.close();
});

/** A board of its own per test: one in-process app, so a previous test's tasks are not in the way. */
function board() {
  const app = makeApp();
  apps.push(app);
  return app;
}

function ticket(id: string, status: string, dependsOn: number[] = []) {
  return `---
id: ${id}
title: Ticket ${id}
milestone: M9-tasks
package: tools
writes:
  - scripts/tickets/**
conformance: []
modes: [local]
depends_on: [${dependsOn.join(", ")}]
status: ${status}
claimed_by: null
issue: null
---

## Done when
It works.
`;
}

/** A ticket tree as the script reads it. */
async function withTickets(files: Record<string, string>, run: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(join(tmpdir(), "openboard-sync-board-"));
  try {
    await mkdir(join(cwd, ".veebee/tickets"), { recursive: true });
    for (const [name, source] of Object.entries(files)) {
      await Bun.write(join(cwd, ".veebee/tickets", name), source);
    }
    await run(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function boardTasks(app: ReturnType<typeof makeApp>) {
  const client = createClient({ url: BOARD_URL, token: OWNER.token, fetch: app.fetch });
  const { tasks } = await client.listTasks({ channel: CHANNEL, state: "all", limit: 100 });
  return tasks.map(({ message }) => ({
    id: message.id,
    text: message.text,
    ticket: message.labels.ticket,
    state: message.task?.state,
    needs: message.task?.needs ?? [],
  }));
}

test("A ready ticket becomes a ready task, a prerequisite's open task makes the next one wait, and a rerun creates nothing", async () => {
  const app = board();
  const files = {
    "01-done.md": ticket("01", "done"),
    "02-ready.md": ticket("02", "ready", [1]),
    "03-waits.md": ticket("03", "ready", [2]),
    "04-draft.md": ticket("04", "draft"),
  };
  await withTickets(files, async (cwd) => {
    const lines: string[] = [];
    const sync = () =>
      syncBoard({ url: BOARD_URL, token: OWNER.token, cwd, fetch: app.fetch, log: (line) => lines.push(line) });

    expect(await sync()).toEqual({ ready: 2, created: 2, skipped: 0 });
    const tasks = await boardTasks(app);
    expect(tasks.map(({ text, ticket, state }) => [text, ticket, state])).toEqual([
      ["02 Ticket 02", "02", "ready"],
      ["03 Ticket 03", "03", "waiting"],
    ]);
    const byTicket = new Map(tasks.map((task) => [task.ticket, task]));
    // 01 is done, so 02 waits on nothing; 03's prerequisite has an open task, so 03 waits on it.
    expect(byTicket.get("02")?.needs).toEqual([]);
    expect(byTicket.get("03")?.needs).toEqual([byTicket.get("02")?.id]);
    expect(lines.join("\n")).not.toContain(OWNER.token);

    expect(await sync()).toEqual({ ready: 2, created: 0, skipped: 2 });
    expect(await boardTasks(app)).toEqual(tasks);
    expect(lines.join("\n")).toContain("skipped 02: task #");
    expect(lines.join("\n")).toContain("skipped 03: task #");
    expect(lines.at(-1)).toBe("Ready tickets: 2; tasks created: 0; skipped: 2.");
  });
});

test("A prerequisite that is not done and has no task leaves the ticket ready, and the log names it", async () => {
  const app = board();
  const files = { "06-draft.md": ticket("06", "draft"), "07-ready.md": ticket("07", "ready", [6]) };
  await withTickets(files, async (cwd) => {
    const lines: string[] = [];
    const report = await syncBoard({
      url: BOARD_URL,
      token: OWNER.token,
      cwd,
      fetch: app.fetch,
      log: (line) => lines.push(line),
    });
    expect(report).toEqual({ ready: 1, created: 1, skipped: 0 });
    expect(lines[0]).toBe("created 07: task #2 ready; 06 has no task yet");
    const [task] = await boardTasks(app);
    expect(task).toEqual(expect.objectContaining({ text: "07 Ticket 07", ticket: "07", state: "ready", needs: [] }));
  });
});

test("The command reads the secret from stdin, prints no secret, and refuses a missing URL or a remote HTTP board", async () => {
  const app = board();
  await withTickets({ "08-ready.md": ticket("08", "ready") }, async (cwd) => {
    const printed: string[] = [];
    let read = 0;
    const code = await runSyncBoard(["--url", BOARD_URL], {
      cwd,
      fetch: app.fetch,
      log: (line) => printed.push(line),
      err: (line) => printed.push(line),
      readSecret: async () => {
        read++;
        return `${OWNER.token}\n`;
      },
    });
    expect(code).toBe(0);
    expect(read).toBe(1);
    expect(printed.join("\n")).toContain("created 08: task #");
    expect(printed.join("\n")).not.toContain(OWNER.token);
    expect(await boardTasks(app)).toContainEqual(expect.objectContaining({ text: "08 Ticket 08", ticket: "08" }));
  });

  const usage = "Usage: bun scripts/tickets/sync-board.ts --url <BOARD_URL> < secret-file";
  const refused: string[] = [];
  const deps = { readSecret: async () => "secret", err: (line: string) => refused.push(line) };
  expect(await runSyncBoard([], deps)).toBe(2);
  expect(await runSyncBoard(["--url"], deps)).toBe(2);
  expect(await runSyncBoard(["--channel", "dev"], deps)).toBe(2);
  expect(refused).toEqual([usage, usage, usage]);
  await expect(
    runSyncBoard(["--url", "http://board.example/api/local/main"], { readSecret: async () => "secret" }),
  ).rejects.toThrow("Use an HTTPS board URL, or HTTP on 127.0.0.1");
  await expect(runSyncBoard(["--url", BOARD_URL], { readSecret: async () => "" })).rejects.toThrow(
    "Provide the board connection secret on stdin",
  );
});
