import { expect, test } from "bun:test";
import type { Message } from "@openboard/contract";
import { call, makeApp } from "../support/app.ts";

test("refused cycles leave the task unchanged and removing an edge allows a later change", async () => {
  const app = makeApp();
  try {
    const create = async (text: string, needs?: string[]) => {
      const response = await call(app, "POST", "/tasks", { channel: "dev", text, needs });
      expect(response.status).toBe(201);
      return ((await response.json()) as { task: Message }).task.id;
    };
    const first = await create("first");
    const second = await create("second", [first]);
    const third = await create("third", [second]);
    const change = (id: string, needs: string[]) => call(app, "POST", `/tasks/${id}/needs`, { needs });
    for (const id of [first, second, third]) {
      const refused = await change(first, [id]);
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({ error: { code: "invalid_needs" } });
    }
    const read = await call(app, "GET", `/messages/${first}`);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ message: { task: { state: "ready", needs: [] } } });

    expect((await change(second, [])).status).toBe(200);
    const changed = await change(first, [third]);
    expect(changed.status).toBe(200);
    expect(await changed.json()).toMatchObject({ task: { task: { state: "waiting", needs: [third] } } });
  } finally {
    await app.close();
  }
});
