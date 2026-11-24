import { expect, test } from "bun:test";
import type { listTasks, Message, OutputOf } from "@openboard/contract";
import { call, makeApp } from "../support/app.ts";

test("filters direct dependants before applying task-list pagination", async () => {
  const app = makeApp();
  async function create(channel: string, needs: string[] = []): Promise<string> {
    const response = await call(app, "POST", "/tasks", { channel, text: "task", needs });
    expect(response.status).toBe(201);
    return ((await response.json()) as { task: Message }).task.id;
  }
  async function list(query: string) {
    const response = await call(app, "GET", `/tasks?${query}`);
    expect(response.status).toBe(200);
    const page = (await response.json()) as OutputOf<typeof listTasks>;
    return { ids: page.tasks.map(({ message }) => message.id), cursor: page.cursor };
  }
  try {
    const prerequisite = await create("dev");
    const here = await create("dev", [prerequisite]);
    const there = await create("dev/web", [prerequisite]);
    const outside = await create("devops", [prerequisite]);
    await create("dev", [here]);

    const filter = `needs=${prerequisite}`;
    expect((await list(filter)).ids).toEqual([here, there, outside]);
    expect(await list(`${filter}&channel=dev/&limit=1`)).toEqual({ ids: [here], cursor: here });
    expect((await list(`${filter}&channel=dev/&after=${here}`)).ids).toEqual([there]);
    expect((await list(`${filter}&state=ready`)).ids).toEqual([]);
    expect((await list("needs=missing")).ids).toEqual([]);
  } finally {
    await app.close();
  }
});
