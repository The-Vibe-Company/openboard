import { expect, test } from "bun:test";
import type { listTasks, Message, OutputOf } from "@openboard/contract";
import { call, makeApp } from "../support/app.ts";

test("limits matching tasks by activity, returns latest active last and includes the latest reply", async () => {
  const app = makeApp();
  try {
    const create = async (text: string) => {
      const labels = text === "excluded" ? {} : { pick: "yes" };
      const response = await call(app, "POST", "/tasks", { channel: "dev", text, labels });
      expect(response.status).toBe(201);
      return ((await response.json()) as { task: Message }).task.id;
    };
    const first = await create("first");
    const second = await create("second");
    const third = await create("third");
    const excluded = await create("excluded");
    for (const re of [second, third, first, excluded]) {
      const response = await call(app, "POST", "/messages", { re, text: `progress on ${re}` });
      expect(response.status).toBe(201);
    }
    const list = async (latest: string) => {
      const response = await call(app, "GET", `/tasks?channel=dev&label=pick=yes&state=all&limit=2&latest=${latest}`);
      expect(response.status).toBe(200);
      return (await response.json()) as OutputOf<typeof listTasks>;
    };
    const latest = await list("true");
    expect(latest.tasks.map(({ message, last }) => [message.id, last?.text])).toEqual([
      [third, `progress on ${third}`],
      [first, `progress on ${first}`],
    ]);
    const feed = await call(app, "GET", "/events");
    expect(latest.cursor).toBe(((await feed.json()) as { cursor: string }).cursor);
    expect(await list("1")).toEqual(latest);
    for (const disabled of ["false", "0"]) {
      expect((await list(disabled)).tasks.map(({ message }) => message.id)).toEqual([first, second]);
    }
  } finally {
    await app.close();
  }
});

test("rejects an after cursor with latest", async () => {
  const app = makeApp();
  try {
    const response = await call(app, "GET", "/tasks?channel=dev&latest=true&after=2");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_request" } });
  } finally {
    await app.close();
  }
});
