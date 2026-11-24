import { expect, test } from "bun:test";
import type { createTask, OutputOf, postMessage } from "@openboard/contract";
import { BOARD_URL, LOCAL_OWNER, makeApp, OWNER } from "../support/app.ts";

function narrowed(app: ReturnType<typeof makeApp>, profile?: string) {
  return (method: string, path: string, body?: object) =>
    app.fetch(
      new Request(`${BOARD_URL}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${OWNER.token}`,
          "x-board-can": "dev=read,post,react,label",
          ...(profile && { "x-board-profile": profile }),
          ...(body && { "content-type": "application/json" }),
        },
        body: JSON.stringify(body),
      }),
    );
}

async function create(write: ReturnType<typeof narrowed>, text: string) {
  const response = await write("POST", "/tasks", { channel: "dev", text });
  expect(response.status).toBe(201);
  return ((await response.json()) as OutputOf<typeof createTask>).task;
}

test("narrowed task writes follow the maker profile and its principal", async () => {
  const app = makeApp();
  try {
    const principal = narrowed(app);
    const own = narrowed(app, "own");
    const other = narrowed(app, "other");
    const prerequisite = await create(principal, "prerequisite");
    const personal = await create(principal, "principal's task");
    const sibling = await create(other, "other profile's task");
    const owned = await create(own, "own profile's task");
    const actor = `${LOCAL_OWNER}+own`;
    const operations = [
      { route: "assign", body: { for: actor }, task: { for: actor } },
      { route: "needs", body: { needs: [prerequisite.id] }, task: { needs: [prerequisite.id], state: "waiting" } },
      {
        route: "block",
        body: { reason: "waiting for input" },
        task: { blocked: { reason: "waiting for input" }, state: "blocked" },
      },
      { route: "cancel", body: { reason: "finished checking" }, task: { state: "canceled" } },
    ];

    for (const target of [personal, sibling]) {
      for (const { route, body } of operations) {
        const denied = await own("POST", `/tasks/${target.id}/${route}`, body);
        expect(denied.status).toBe(403);
        expect(await denied.json()).toMatchObject({ error: { code: "task_not_owned" } });
      }
      const read = await principal("GET", `/messages/${target.id}`);
      expect(read.status).toBe(200);
      expect(await read.json()).toMatchObject({ message: { version: target.version, task: target.task } });
    }

    for (const [write, target] of [
      [principal, personal],
      [principal, sibling],
      [own, owned],
      [principal, await create(own, "another own profile task")],
    ] as const) {
      for (const { route, body, task } of operations) {
        const changed = await write("POST", `/tasks/${target.id}/${route}`, body);
        expect(changed.status).toBe(200);
        expect(await changed.json()).toMatchObject({ task: { id: target.id, task } });
      }
    }
  } finally {
    await app.close();
  }
});

test("a narrowed profile edit holds the task its principal made from the profile's thread", async () => {
  const app = makeApp();
  try {
    const principal = narrowed(app);
    const own = narrowed(app, "own");
    const posted = await own("POST", "/messages", { channel: "dev", text: "work" });
    expect(posted.status).toBe(201);
    const { message } = (await posted.json()) as OutputOf<typeof postMessage>;

    const adopted = await principal("POST", "/tasks", { re: message.id });
    expect(adopted.status).toBe(201);
    expect(await adopted.json()).toMatchObject({
      task: { id: message.id, task: { by: LOCAL_OWNER, state: "ready" } },
    });

    const edit = await own("POST", `/messages/${message.id}/edit`, { text: "updated work" });
    expect(edit.status).toBe(200);
    const read = await own("GET", `/messages/${message.id}`);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      message: { id: message.id, text: "updated work", task: { state: "blocked", blocked: { kind: "edited" } } },
    });
  } finally {
    await app.close();
  }
});
