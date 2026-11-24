import { expect, test } from "bun:test";
import type { Message } from "@openboard/contract";
import { decideCreateTask, decideMakeTask } from "../../src/index.ts";

test("the principal owns a task even when it is created as a profile", () => {
  const by = { actor: "owner+bot", principal: "owner", profile: "bot" };
  const { events, task } = decideCreateTask(
    { head: 9 },
    { channel: "dev", text: "fix the build" },
    { by, now: 1_700_000_000_000 },
  );
  expect(events.map(({ id, type, message }) => ({ id, type, message }))).toEqual([
    { id: 10, type: "message.posted", message: 10 },
    { id: 11, type: "task.created", message: 10 },
  ]);
  expect(task.task).toMatchObject({ owner: "owner", by: "owner+bot", state: "ready" });
});

const ROOT = {
  id: "2",
  thread: "2",
  re: null,
  channel: "dev",
  text: "flaky test in ci",
  labels: { area: "ci" },
  deleted: false,
  version: 2,
  by: { actor: "ada", principal: "ada", profile: null },
} as unknown as Message;

test("a thread made a task keeps its root and records who made it a task, posting nothing", () => {
  const by = { actor: "owner+triage", principal: "owner", profile: "triage" };
  const { events, task } = decideMakeTask({ head: 5, target: ROOT }, "2", { by, now: 1_700_000_000_000 });
  expect(events.map(({ id, type, message, channel, actor }) => ({ id, type, message, channel, actor }))).toEqual([
    { id: 6, type: "task.created", message: 2, channel: "dev", actor: "owner+triage" },
  ]);
  expect(task).toMatchObject({ id: "2", text: "flaky test in ci", version: 6, by: ROOT.by });
  expect(task.labels).toEqual({ area: "ci", "board.task": "ready" });
  expect(task.task).toMatchObject({ state: "ready", owner: "owner", by: "owner+triage" });
});

test("only a live thread root that is no task yet can be made a task", () => {
  const by = { actor: "owner", principal: "owner", profile: null };
  const make = (target: Message | null) => () => decideMakeTask({ head: 9, target }, "2", { by, now: 0 });
  expect(make(null)).toThrow(expect.objectContaining({ code: "message_not_found" }));
  expect(make({ ...ROOT, id: "3", re: "2" })).toThrow(expect.objectContaining({ code: "invalid_request" }));
  expect(make({ ...ROOT, deleted: true })).toThrow(expect.objectContaining({ code: "message_deleted" }));
  const task = decideMakeTask({ head: 9, target: ROOT }, "2", { by, now: 0 }).task;
  expect(make(task)).toThrow(expect.objectContaining({ code: "already_a_task" }));
});
