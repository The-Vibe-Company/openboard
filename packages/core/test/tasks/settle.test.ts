import { expect, test } from "bun:test";
import { decideClaimTask, decideCompleteTask, decideCreateTask } from "../../src/index.ts";

test("completing without a result records null and keeps the claim epoch", () => {
  const by = { actor: "agent", principal: "agent", profile: null };
  const now = 1_700_000_000_000;
  const { task } = decideCreateTask({ head: 0 }, { channel: "dev", text: "work" }, { by, now });
  const claimed = decideClaimTask(
    { head: task.version, target: task },
    { id: task.id, tokenHash: "test hash" },
    { by, now },
  );
  const settled = decideCompleteTask(
    {
      head: claimed.task.version,
      target: claimed.task,
      actor: null,
      proof: { tokenMatches: true, until: now + 900_000 },
    },
    { id: task.id, epoch: claimed.claim.epoch },
    { by, now },
  );
  expect(settled.task.task).toMatchObject({ state: "completed", claim: null, result: null, epoch: 1 });
  expect(settled.events.at(-1)).toMatchObject({
    type: "task.completed",
    id: settled.task.version,
    payload: { id: Number(task.id), epoch: 1, result: null },
  });
});
