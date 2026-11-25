import { expect, test } from "bun:test";
import type { createTask, OutputOf } from "@openboard/contract";
import { call, makeApp } from "../support/app.ts";

test("a caller with read and post can read a ready task but cannot claim it by ID or by channel", async () => {
  const app = makeApp();
  const narrowed = {
    fetch(request: Request) {
      request.headers.set("x-board-can", "dev=read,post");
      return app.fetch(request);
    },
  };

  try {
    const created = await call(app, "POST", "/tasks", { channel: "dev", text: "Ready task" });
    expect(created.status).toBe(201);
    const { task } = (await created.json()) as OutputOf<typeof createTask>;

    const read = async () => {
      const response = await call(narrowed, "GET", `/messages/${task.id}`);
      expect(response.status).toBe(200);
      return response.json();
    };
    const before = await read();
    expect(before).toMatchObject({ message: { id: task.id, task: { state: "ready" } } });

    const direct = await call(narrowed, "POST", `/tasks/${task.id}/claim`, {});
    expect(direct.status).toBe(403);
    expect(await direct.json()).toMatchObject({ error: { code: "forbidden" } });

    const next = await call(narrowed, "POST", "/tasks/claim", { channel: "dev" });
    expect(next.status).toBe(403);
    expect(await next.json()).toMatchObject({ error: { code: "forbidden" } });
    expect(await read()).toEqual(before);
  } finally {
    await app.close();
  }
});
