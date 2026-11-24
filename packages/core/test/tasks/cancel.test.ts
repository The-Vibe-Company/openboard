import { expect, test } from "bun:test";
import type { Task } from "@openboard/contract";
import { decideCancelTask, decideCreateTask } from "../../src/index.ts";

const by = { actor: "agent", principal: "agent", profile: null };
const context = { by, now: 1_700_000_000_000 };
const { task: root } = decideCreateTask({ head: 0 }, { channel: "dev", text: "work" }, context);

test.each(["waiting", "ready", "claimed", "blocked", "failed"] as const)("can cancel a %s task", (state) => {
  const task: Task = {
    ...root.task,
    state,
    epoch: 1,
    claim: state === "claimed" ? { actor: by.actor, until: "2023-11-14T22:28:20.000Z" } : null,
    blocked: state === "blocked" ? { kind: "manual", reason: "hold" } : null,
  };
  const input = { id: root.id, reason: "not needed" };
  const canceled = decideCancelTask({ head: root.version, target: { ...root, task } }, input, context, ["post"]);
  expect(canceled.task.labels["board.task"]).toBe("canceled");
  expect(canceled.task.task).toMatchObject({
    state: "canceled",
    reason: input.reason,
    claim: null,
    blocked: null,
    epoch: 1,
  });
  expect(canceled.events).toMatchObject([
    { type: "task.canceled", id: canceled.task.version, payload: { id: Number(root.id), reason: input.reason, by } },
  ]);
});

test.each(["completed", "canceled"] as const)("cannot cancel a %s task", (state) => {
  expect(() =>
    decideCancelTask(
      { head: root.version, target: { ...root, task: { ...root.task, state } } },
      { id: root.id, reason: "not needed" },
      context,
      ["label"],
    ),
  ).toThrow(expect.objectContaining({ code: "task_finished" }));
});
