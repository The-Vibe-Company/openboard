import { expect, test } from "bun:test";
import { decideCreateTask } from "../../src/index.ts";

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
