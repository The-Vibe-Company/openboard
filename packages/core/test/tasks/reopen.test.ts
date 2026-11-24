import { expect, test } from "bun:test";
import { decideCreateTask, decideReopenTask } from "../../src/index.ts";

const by = { actor: "agent", principal: "agent", profile: null };
const context = { by, now: 1_700_000_000_000 };
const { task: root } = decideCreateTask({ head: 0 }, { channel: "dev", text: "work" }, context);

test.each(["completed", "canceled"] as const)("cannot reopen a %s task", (state) => {
  const target = { ...root, task: { ...root.task, state } };
  expect(() => decideReopenTask({ head: root.version, target }, root.id, context, ["post"])).toThrow(
    expect.objectContaining({ code: "task_finished" }),
  );
});

test.each(["waiting", "ready", "claimed", "blocked"] as const)("reopening a %s task changes nothing", (state) => {
  const target = { ...root, task: { ...root.task, state } };
  expect(decideReopenTask({ head: root.version, target }, root.id, context, ["post"])).toEqual({
    task: target,
    events: [],
    outcome: "unchanged",
  });
});
