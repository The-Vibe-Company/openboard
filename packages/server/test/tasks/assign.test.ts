import { expect, test } from "bun:test";
import type { createTask, listTasks, OutputOf } from "@openboard/contract";
import { BOARD_URL, call, LOCAL_OWNER, makeApp, OWNER } from "../support/app.ts";

const fixer = `${LOCAL_OWNER}+fixer`;

test("reserves a task for its owner's profile and gives it back to the pool", async () => {
  const app = makeApp();
  try {
    const created = await call(app, "POST", "/tasks", { channel: "dev", text: "repair" });
    expect(created.status).toBe(201);
    const { task } = (await created.json()) as OutputOf<typeof createTask>;
    const path = `/tasks/${task.id}`;
    const assigned = await call(app, "POST", `${path}/assign`, { for: fixer });
    expect(assigned.status).toBe(200);
    expect(await assigned.json()).toMatchObject({ task: { task: { for: fixer } } });
    const denied = await call(app, "POST", `${path}/claim`);
    expect(denied.status).toBe(409);
    expect(await denied.json()).toMatchObject({ error: { code: "task_assigned" } });

    const claimed = await app.fetch(
      new Request(`${BOARD_URL}${path}/claim`, {
        method: "POST",
        headers: { authorization: `Bearer ${OWNER.token}`, "x-board-profile": "Fixer" },
      }),
    );
    expect(claimed.status).toBe(200);
    expect(await claimed.json()).toMatchObject({ task: { task: { claim: { actor: fixer } } } });

    const stillDenied = await call(app, "POST", `${path}/claim`);
    expect(stillDenied.status).toBe(409);
    expect(await stillDenied.json()).toMatchObject({ error: { code: "task_assigned" } });

    const pooled = await call(app, "POST", `${path}/assign`, { for: null });
    expect(pooled.status).toBe(200);
    expect(await pooled.json()).toMatchObject({ task: { task: { for: null, claim: { actor: fixer } } } });
    const feed = await call(app, "GET", "/events?after=0&channel=dev");
    expect(await feed.json()).toMatchObject({
      events: [
        { type: "message.posted" },
        { type: "task.created" },
        { type: "task.assigned", payload: { id: task.id, for: fixer }, message: { task: { for: fixer } } },
        { type: "task.claimed" },
        { type: "task.assigned", payload: { id: task.id, for: null }, message: { task: { for: null } } },
      ],
    });
  } finally {
    await app.close();
  }
});

test("batch assignees participate in idempotency and task filtering", async () => {
  const app = makeApp();
  try {
    const tasks = [{ text: "fix", for: fixer }, { text: "review" }];
    const batch = { channel: "dev", id: "work", tasks };
    const created = await call(app, "POST", "/tasks/batch", batch);
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ tasks: [{ task: { for: fixer } }, { task: { for: null } }] });
    const changed = await call(app, "POST", "/tasks/batch", {
      ...batch,
      tasks: [{ text: "fix", for: null }, tasks[1]],
    });
    expect(changed.status).toBe(409);
    const proxy = { channel: "dev", id: "proxy", request: "digest", tasks };
    expect((await call(app, "POST", "/tasks/batch", proxy)).status).toBe(201);
    const denied = await call(app, "POST", "/tasks/batch", {
      ...proxy,
      tasks: [{ text: "fix", for: "ob:user:other+fixer" }],
    });
    expect(denied.status).toBe(400);
    expect(await denied.json()).toMatchObject({ error: { code: "invalid_request" } });
    const page = await call(app, "GET", `/tasks?for=${encodeURIComponent(fixer)}`);
    const { tasks: rows } = (await page.json()) as OutputOf<typeof listTasks>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ message: { task: { for: fixer } } });
  } finally {
    await app.close();
  }
});

test("a create retry still validates the assignee", async () => {
  const app = makeApp();
  try {
    const input = { id: "retry:assignment", channel: "dev", text: "repair", for: fixer };
    expect((await call(app, "POST", "/tasks", input)).status).toBe(201);
    const denied = await call(app, "POST", "/tasks", { ...input, for: "ob:user:other+fixer" });
    expect(denied.status).toBe(400);
    expect(await denied.json()).toMatchObject({ error: { code: "invalid_request" } });
  } finally {
    await app.close();
  }
});

test("a deleted task root stays finished", async () => {
  const app = makeApp();
  try {
    const created = await call(app, "POST", "/tasks", { channel: "dev", text: "repair" });
    const { task } = (await created.json()) as OutputOf<typeof createTask>;
    expect((await call(app, "POST", `/messages/${task.id}/delete`)).status).toBe(200);
    const denied = await call(app, "POST", `/tasks/${task.id}/assign`, { for: fixer });
    expect(denied.status).toBe(409);
    expect(await denied.json()).toMatchObject({ error: { code: "task_finished" } });
  } finally {
    await app.close();
  }
});
