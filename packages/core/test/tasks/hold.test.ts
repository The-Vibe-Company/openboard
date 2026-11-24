import { expect, test } from "bun:test";
import { decideClaimTask, decideCreateTask } from "../../src/index.ts";
import { expireTask } from "../../src/tasks/expire.ts";
import { taskBlocked } from "../../src/tasks/holds/hold.ts";

test("an expired lease on a held task restores its hold and reserved label", () => {
  const now = 1_700_000_000_000;
  const by = { actor: "agent", principal: "agent", profile: null };
  const { task: ready } = decideCreateTask({ head: 0 }, { channel: "dev", text: "work" }, { by, now });
  const { task: claimed } = decideClaimTask(
    { head: ready.version, target: ready },
    { id: ready.id, lease: 30, tokenHash: "test hash" },
    { by, now },
  );
  const blocked = { kind: "edited", reason: "Root changed" };
  const hold = taskBlocked(claimed, blocked, claimed.version + 1, { by, now });
  const root = { ...claimed, task: { ...claimed.task, blocked } };
  expect(hold.payload.view.task).toMatchObject({ blocked, state: "blocked", claim: null });
  expect(expireTask(root.version, root, now + 30_000)?.payload.view).toMatchObject({
    task: { blocked, state: "blocked", claim: null },
    labels: { "board.task": "blocked" },
  });
});
