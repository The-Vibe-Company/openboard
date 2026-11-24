import { expect, test } from "bun:test";
import type { createTask, OutputOf, postMessage } from "@openboard/contract";
import { call, makeApp } from "../support/app.ts";

const narrowed = (app: ReturnType<typeof makeApp>) => ({
  fetch(request: Request) {
    request.headers.set("x-board-can", "*=post;dev=read,post,label");
    return app.fetch(request);
  },
});

test("narrowed create, conversion, replacement and batch reject unreadable prerequisites without writing", async () => {
  const app = makeApp();
  const caller = narrowed(app);
  try {
    const hiddenResponse = await call(app, "POST", "/tasks", { channel: "dev/tasks", text: "hidden" });
    expect(hiddenResponse.status).toBe(201);
    const { task: hidden } = (await hiddenResponse.json()) as OutputOf<typeof createTask>;
    const readyResponse = await call(caller, "POST", "/tasks", { channel: "dev", text: "visible" });
    expect(readyResponse.status).toBe(201);
    const { task: visible } = (await readyResponse.json()) as OutputOf<typeof createTask>;
    const posted = await call(caller, "POST", "/messages", { channel: "dev", text: "plain" });
    expect(posted.status).toBe(201);
    const {
      message: { id },
    } = (await posted.json()) as OutputOf<typeof postMessage>;
    const before = await (await call(app, "GET", "/events?after=0")).json();

    const needs = [hidden.id];
    for (const [path, body] of [
      ["/tasks", { channel: "dev", text: "refused", needs }],
      ["/tasks", { re: id, needs }],
      [`/tasks/${visible.id}/needs`, { needs }],
      ["/tasks/batch", { channel: "dev", tasks: [{ text: "valid" }, { text: "refused", needs }] }],
    ] as const) {
      const response = await call(caller, "POST", path, body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "invalid_needs", message: `#${hidden.id} must name another task you can read.` },
      });
    }
    expect(await (await call(app, "GET", "/events?after=0")).json()).toEqual(before);
    const list = await call(app, "GET", `/tasks?needs=${hidden.id}`);
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ tasks: [] });

    const waiting = await call(caller, "POST", "/tasks", { channel: "dev", text: "waiting", needs: [visible.id] });
    expect(waiting.status).toBe(201);
    expect(await waiting.json()).toMatchObject({ task: { task: { state: "waiting", needs: [visible.id] } } });
  } finally {
    await app.close();
  }
});

test("a task list treats unreadable prerequisites as missing in its needs filter", async () => {
  const app = makeApp();
  const caller = narrowed(app);
  try {
    const create = async (channel: string, needs?: string[]) => {
      const response = await call(app, "POST", "/tasks", { channel, text: "task", needs });
      expect(response.status).toBe(201);
      return ((await response.json()) as OutputOf<typeof createTask>).task;
    };
    const hidden = await create("dev/tasks");
    const visible = await create("dev");
    const dependent = await create("dev", [hidden.id, visible.id]);

    const list = async (client: typeof caller, id: string) => {
      const response = await call(client, "GET", `/tasks?channel=dev&needs=${id}`);
      expect(response.status).toBe(200);
      return response.json();
    };
    expect(await list(app, hidden.id)).toMatchObject({ tasks: [{ message: { id: dependent.id } }] });
    expect(await list(caller, visible.id)).toMatchObject({ tasks: [{ message: { id: dependent.id } }] });
    const missing = await list(caller, "999");
    expect(missing).toMatchObject({ tasks: [] });
    expect(await list(caller, hidden.id)).toEqual(missing);
  } finally {
    await app.close();
  }
});
