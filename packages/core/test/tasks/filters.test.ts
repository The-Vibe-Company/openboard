import { expect, test } from "bun:test";
import { taskCursor, taskStates } from "../../src/index.ts";

test("a task list shows open tasks unless it asks for all or one state", () => {
  expect(taskStates(undefined)).toEqual(["waiting", "ready", "claimed", "blocked"]);
  expect(taskStates("open")).toEqual(["waiting", "ready", "claimed", "blocked"]);
  expect(taskStates("all")).toEqual(["waiting", "ready", "claimed", "blocked", "completed", "failed", "canceled"]);
  expect(taskStates("completed")).toEqual(["completed"]);
  expect(() => taskStates("done")).toThrow("state: done");
});

test("a full task page goes on after its last task, a shorter one from the board's head", () => {
  expect(taskCursor([2, 5], 2, 9)).toBe(5);
  expect(taskCursor([2], 2, 9)).toBe(9);
  expect(taskCursor([], 50, 9)).toBe(9);
});
