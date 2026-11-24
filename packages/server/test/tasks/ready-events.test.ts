import { expect, test } from "bun:test";
import type { completeTask, createTask, OutputOf, postMessage, readEvents, Task } from "@openboard/contract";
import { call, makeApp } from "../support/app.ts";

async function create(app: ReturnType<typeof makeApp>, input: Record<string, unknown>) {
  const response = await call(app, "POST", "/tasks", input);
  expect(response.status).toBe(201);
  return (await response.json()) as OutputOf<typeof createTask>;
}

async function readFeed(app: ReturnType<typeof makeApp>, after = 0) {
  const response = await call(app, "GET", `/events?after=${after}`);
  expect(response.status).toBe(200);
  return ((await response.json()) as OutputOf<typeof readEvents>).events;
}

function taskEvents(events: Awaited<ReturnType<typeof readFeed>>) {
  return events
    .filter(({ type }) => type.startsWith("task."))
    .map((event) => {
      const { type, cursor } = event;
      const message = "message" in event ? event.message : undefined;
      return {
        type,
        cursor: Number(cursor),
        id: message?.id,
        state: message?.task?.state,
        label: message?.labels["board.task"],
        version: message?.version,
      };
    });
}

function transition(
  type: OutputOf<typeof readEvents>["events"][number]["type"],
  cursor: number,
  id: string,
  state: Task["state"],
) {
  return { type, cursor, id, state, label: state, version: cursor };
}

test("the final prerequisite completes before each dependant becomes ready", async () => {
  const app = makeApp();
  try {
    const { task: prerequisite, claim } = await create(app, { channel: "dev", text: "build", claim: true });
    const { task: first } = await create(app, { channel: "dev", text: "test", needs: [prerequisite.id] });
    const { task: second } = await create(app, { channel: "release", text: "deploy", needs: [prerequisite.id] });
    const response = await call(app, "POST", `/tasks/${prerequisite.id}/complete`, {
      token: claim?.token,
      epoch: claim?.epoch,
    });
    expect(response.status).toBe(200);
    const { task: completed } = (await response.json()) as OutputOf<typeof completeTask>;
    const cursor = completed.version;
    expect(taskEvents(await readFeed(app, cursor - 1))).toEqual([
      transition("task.completed", cursor, prerequisite.id, "completed"),
      transition("task.ready", cursor + 1, first.id, "ready"),
      transition("task.ready", cursor + 2, second.id, "ready"),
    ]);
  } finally {
    await app.close();
  }
});

test("creation emits waiting, then ready when every need is already completed, then an optional claim", async () => {
  const app = makeApp();
  try {
    const { task: prerequisite, claim } = await create(app, { channel: "dev", text: "build", claim: true });
    expect(taskEvents(await readFeed(app))).toEqual([
      transition("task.created", prerequisite.version - 1, prerequisite.id, "ready"),
      transition("task.claimed", prerequisite.version, prerequisite.id, "claimed"),
    ]);
    const completed = await call(app, "POST", `/tasks/${prerequisite.id}/complete`, {
      token: claim?.token,
      epoch: claim?.epoch,
    });
    expect(completed.status).toBe(200);
    const { task: settled } = (await completed.json()) as OutputOf<typeof completeTask>;
    const needs = [prerequisite.id];
    const { task: ready } = await create(app, { channel: "dev", text: "test", needs });
    expect(ready.task.state).toBe("ready");
    const root = await call(app, "POST", "/messages", { channel: "dev", text: "deploy" });
    expect(root.status).toBe(201);
    const { message } = (await root.json()) as OutputOf<typeof postMessage>;
    const { task: claimed } = await create(app, { re: message.id, needs, claim: true });
    expect(claimed.task.state).toBe("claimed");
    expect(taskEvents(await readFeed(app, settled.version))).toEqual([
      transition("task.created", ready.version - 1, ready.id, "waiting"),
      transition("task.ready", ready.version, ready.id, "ready"),
      transition("task.created", claimed.version - 2, claimed.id, "waiting"),
      transition("task.ready", claimed.version - 1, claimed.id, "ready"),
      transition("task.claimed", claimed.version, claimed.id, "claimed"),
    ]);
  } finally {
    await app.close();
  }
});
