import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { OPENBOARD_RUN: run, OPENBOARD_TASK: thread, BOARD_PROFILE: profile, BOARD_TOKEN: token } = process.env;
assert.equal(
  Object.keys(process.env)
    .filter((key) => key !== "OPENBOARD_WAKE_FILE" && key !== "OPENBOARD_WAKE")
    .sort()
    .join(","),
  "BOARD_PROFILE,BOARD_TOKEN,BOARD_URL,OPENBOARD_RUN,OPENBOARD_TASK",
);
assert.ok(thread);
assert.ok(run);
assert.ok(profile === `run-${thread}`);
assert.ok(token?.startsWith("obt_"));

const [node, ob] = Bun.argv.slice(2);
assert.ok(node && ob);
// The CLI needs a private HOME to share its lease proof between the two commands.
const home = await mkdtemp(join(tmpdir(), "openboard-task-"));
try {
  for (const args of [
    ["claim", thread],
    ["complete", thread, "done"],
  ]) {
    const status: number = await Bun.spawn([node, ob, "tasks", ...args], {
      env: { ...process.env, HOME: home },
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    }).exited;
    assert.equal(status, 0);
  }
} finally {
  await rm(home, { recursive: true, force: true });
}
