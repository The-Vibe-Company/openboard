import { expect, test } from "bun:test";
import type { Task, TaskActor } from "../src/api/tasks.ts";
import { taskStateText } from "../src/components/TaskState.tsx";

const states = {
  blocked: "blocked",
  canceled: "canceled",
  completed: "completed",
  failed: "failed",
  ready: "ready",
  waiting: "waiting",
} satisfies Record<Exclude<Task["state"], "claimed">, string>;

for (const state of Object.keys(states) as (keyof typeof states)[]) {
  test(`shows ${state}`, () => {
    expect(taskStateText({ state, claim: null })).toBe(states[state]);
  });
}

test("shows the claim holder and their connection", () => {
  const actor: TaskActor = {
    id: "actor",
    kind: "agent",
    handle: "agents/fixer",
    name: "fixer",
    avatar: null,
    via: { name: "agents", environment: null },
  };
  const task = { state: "claimed", claim: { actor: actor.id, until: "2026-01-01T12:00:00.000Z" } } as const;
  expect(taskStateText(task, actor)).toBe("claimed by fixer via agents");
  expect(taskStateText(task, { ...actor, kind: "person", via: undefined })).toBe("claimed by fixer");
  expect(taskStateText(task)).toBe("claimed by actor");
});
