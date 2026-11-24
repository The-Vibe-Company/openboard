import { expect, test } from "bun:test";
import type { createTask, createTaskBatch, InputOf, OutputOf } from "@openboard/contract";
import { call, makeApp } from "../support/app.ts";

type Tasks = InputOf<typeof createTaskBatch>["tasks"];

const invalidPlans: [string, Tasks][] = [
  [
    "duplicate keys",
    [
      { key: "same", text: "first" },
      { key: "same", text: "last" },
    ],
  ],
  ["an unknown key", [{ text: "last", needs: [{ key: "missing" }] }]],
  ["a self dependency", [{ key: "self", text: "last", needs: [{ key: "self" }] }]],
  [
    "a dependency cycle",
    [
      { key: "left", text: "left", needs: [{ key: "right" }] },
      { key: "right", text: "right", needs: [{ key: "left" }] },
    ],
  ],
];

async function expectRefused(
  app: ReturnType<typeof makeApp>,
  tasks: readonly unknown[],
  code: "invalid_needs" | "batch_too_large",
) {
  const id = "refused-plan";
  const response = await call(app, "POST", "/tasks/batch", { channel: "dev", tasks, id });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code } });
  const list = await call(app, "GET", "/tasks?channel=dev&state=all");
  expect(list.status).toBe(200);
  expect(await list.json()).toMatchObject({ tasks: [] });
  const lookup = await call(app, "GET", `/tasks/batch/${id}`);
  expect(lookup.status).toBe(404);
  expect(await lookup.json()).toMatchObject({ error: { code: "batch_not_found" } });
}

test.each(invalidPlans)("makes none of a batch with %s", async (_name, invalid) => {
  const app = makeApp();
  try {
    const valid = { text: "valid task" };
    await expectRefused(app, [...invalid, valid], "invalid_needs");
    await expectRefused(app, [valid, ...invalid], "invalid_needs");
  } finally {
    await app.close();
  }
});

test("makes none when the last batch task needs a canceled task", async () => {
  const app = makeApp();
  try {
    const created = await call(app, "POST", "/tasks", { channel: "prereqs", text: "dropped" });
    expect(created.status).toBe(201);
    const { task } = (await created.json()) as OutputOf<typeof createTask>;
    const canceled = await call(app, "POST", `/tasks/${task.id}/cancel`, { reason: "dropped" });
    expect(canceled.status).toBe(200);
    await expectRefused(app, [{ text: "first" }, { text: "last", needs: [task.id] }], "invalid_needs");
  } finally {
    await app.close();
  }
});

test("makes none of a batch of 101 tasks", async () => {
  const app = makeApp();
  try {
    const tasks = Array.from({ length: 100 }, (_, i) => ({ text: `task ${i + 1}` }));
    await expectRefused(app, [...tasks, { text: "task 101" }], "batch_too_large");
    await expectRefused(app, [...tasks, {}], "batch_too_large");
    const allowed = await call(app, "POST", "/tasks/batch", { channel: "dev", tasks });
    expect(allowed.status).toBe(201);
    expect(((await allowed.json()) as OutputOf<typeof createTaskBatch>).tasks).toHaveLength(100);
  } finally {
    await app.close();
  }
});
