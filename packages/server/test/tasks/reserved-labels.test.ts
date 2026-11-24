import { expect, test } from "bun:test";
import type { Message } from "@openboard/contract";
import { call, makeApp } from "../support/app.ts";

async function createTask(app: ReturnType<typeof makeApp>) {
  const response = await call(app, "POST", "/tasks", { channel: "dev", text: "protect task state" });
  expect(response.status).toBe(201);
  const { task } = (await response.json()) as { task: Message };
  return task;
}

async function readTask(app: ReturnType<typeof makeApp>, id: string) {
  const response = await call(app, "GET", `/messages/${id}`);
  expect(response.status).toBe(200);
  const { message } = (await response.json()) as { message: Message };
  return message;
}

test("clients cannot set or unset board labels through label writes or posts", async () => {
  const app = makeApp();
  try {
    const task = await createTask(app);
    const labelsPath = `/messages/${task.id}/labels`;
    const attempts = [
      [labelsPath, { set: { "board.task": "completed" } }],
      [labelsPath, { unset: ["board.task"] }],
      ["/messages", { channel: "dev", text: "post", labels: { "board.task": "ready" } }],
      ["/tasks", { channel: "dev", text: "task", labels: { "board.x": "1" } }],
    ] as const;
    for (const [path, body] of attempts) {
      const response = await call(app, "POST", path, body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "reserved_label" } });
    }
    expect(task).toMatchObject({ labels: { "board.task": "ready" }, task: { state: "ready" } });
    expect(await readTask(app, task.id)).toEqual(task);
    const feed = await call(app, "GET", `/events?after=${task.version}`);
    expect(await feed.json()).toEqual({ cursor: String(task.version), events: [] });
  } finally {
    await app.close();
  }
});

test("a label write can test a board label and only applies when the condition matches", async () => {
  const app = makeApp();
  try {
    const task = await createTask(app);
    const path = `/messages/${task.id}/labels`;
    const accepted = await call(app, "POST", path, {
      set: { seen: "yes" },
      if: { "board.task": "ready" },
    });
    expect(accepted.status).toBe(200);
    const updated = await readTask(app, task.id);
    expect(updated.labels).toEqual({ "board.task": "ready", seen: "yes" });
    for (const wanted of ["claimed", null]) {
      const response = await call(app, "POST", path, {
        set: { seen: "no" },
        if: { "board.task": wanted },
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "label_conflict" } });
    }
    expect(await readTask(app, task.id)).toEqual(updated);
    const feed = await call(app, "GET", `/events?after=${updated.version}`);
    expect(await feed.json()).toEqual({ cursor: String(updated.version), events: [] });
  } finally {
    await app.close();
  }
});
