import { afterEach, expect, test } from "bun:test";
import type { Message, OutputOf, readEvents } from "@openboard/contract";
import { BOARD_URL, call, LOCAL_OWNER, makeApp } from "../support/app.ts";

let app: ReturnType<typeof makeApp>;
afterEach(() => app.close());

test("creating a task posts its root then publishes task.created with the task view", async () => {
  app = makeApp();
  const response = await call(app, "POST", "/tasks", {
    channel: "dev",
    text: "fix the build",
    labels: { repo: "web" },
    noSync: true,
  });
  expect(response.status).toBe(201);
  const { task } = (await response.json()) as { task: Message };
  expect(task).toMatchObject({
    id: "2",
    thread: "2",
    text: "fix the build",
    noSync: true,
    re: null,
    labels: { repo: "web", "board.task": "ready" },
    task: {
      state: "ready",
      owner: LOCAL_OWNER,
      by: LOCAL_OWNER,
      for: null,
      needs: [],
      epoch: 0,
      claim: null,
      blocked: null,
      result: null,
      reason: null,
    },
  });
  for (const query of ["after=0", "channel=dev&last=2"]) {
    const feed = await call(app, "GET", `/events?${query}`);
    expect(feed.status).toBe(200);
    const { events } = (await feed.json()) as OutputOf<typeof readEvents>;
    expect(events.map(({ type }) => type)).toEqual(["message.posted", "task.created"]);
    expect(events[1]).toEqual({
      cursor: "3",
      type: "task.created",
      createdAt: task.createdAt,
      payload: {
        id: "2",
        thread: "2",
        needs: [],
        for: null,
        by: { actor: LOCAL_OWNER, principal: LOCAL_OWNER, profile: null },
      },
      message: task,
    });
  }
});

test.each([
  ["read", {}],
  ["post", { labels: { repo: "web" } }],
] as const)("a task write with only %s permission is refused when it needs more", async (permission, extra) => {
  app = makeApp();
  const issued = await call(app, "POST", "/x/connections", {
    name: "restricted",
    direct: true,
    can: { dev: [permission] },
  });
  expect(issued.status).toBe(201);
  const { secret } = (await issued.json()) as { secret: string };
  const head = await call(app, "GET", "/events");
  const { cursor } = (await head.json()) as { cursor: string };
  const response = await app.fetch(
    new Request(`${BOARD_URL}/tasks`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ channel: "dev", text: "fix the build", ...extra }),
    }),
  );
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
  const feed = await call(app, "GET", `/events?after=${cursor}`);
  expect(await feed.json()).toEqual({ cursor, events: [] });
});
