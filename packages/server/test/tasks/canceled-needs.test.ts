import { expect, test } from "bun:test";
import type { claimTask, createTask, Message, OutputOf } from "@openboard/contract";
import { call, makeApp } from "../support/app.ts";

async function create(app: ReturnType<typeof makeApp>, text: string, needs?: string[]) {
  const response = await call(app, "POST", "/tasks", { channel: "dev", text, needs });
  expect(response.status).toBe(201);
  return ((await response.json()) as OutputOf<typeof createTask>).task;
}

test("a canceled prerequisite prevents both forms of task creation", async () => {
  const app = makeApp();
  try {
    const canceled = await create(app, "dropped");
    const cancel = await call(app, "POST", `/tasks/${canceled.id}/cancel`, { reason: "dropped" });
    expect(cancel.status).toBe(200);
    const post = await call(app, "POST", "/messages", { channel: "dev", text: "plain thread" });
    expect(post.status).toBe(201);
    const { message: root } = (await post.json()) as { message: Message };

    for (const input of [{ channel: "dev", text: "x" }, { re: root.id }]) {
      const refused = await call(app, "POST", "/tasks", { ...input, needs: [canceled.id] });
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({ error: { code: "invalid_needs" } });
    }
    const read = await call(app, "GET", `/messages/${root.id}`);
    expect(read.status).toBe(200);
    const { message } = (await read.json()) as { message: Message };
    expect(message).toEqual(root);
  } finally {
    await app.close();
  }
});

test("a failed prerequisite keeps a new task waiting", async () => {
  const app = makeApp();
  try {
    const failed = await create(app, "build");
    const path = `/tasks/${failed.id}`;
    const claimed = await call(app, "POST", `${path}/claim`);
    expect(claimed.status).toBe(200);
    const { claim } = (await claimed.json()) as OutputOf<typeof claimTask>;
    const settled = await call(app, "POST", `${path}/fail`, { token: claim.token, epoch: claim.epoch, reason: "x" });
    expect(settled.status).toBe(200);

    const dependent = await create(app, "y", [failed.id]);
    expect(dependent.task).toMatchObject({ state: "waiting", needs: [failed.id] });
  } finally {
    await app.close();
  }
});
