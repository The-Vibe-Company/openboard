import { expect, test } from "bun:test";
import type { CreatedConnection, ErrorBody, OutputOf, postMessage, readEvents } from "@openboard/contract";
import { BOARD_URL, call, makeApp, NOW, OWNER } from "./support/app.ts";
import { openStore } from "./support/drivers.ts";

test("reads a posted message once from its event cursor, its writer's actor.seen left out", async () => {
  const app = makeApp();
  try {
    const post = await call(app, "POST", "/messages", { channel: "dev", text: "hello" });
    expect(post.status).toBe(201);
    const { message } = (await post.json()) as OutputOf<typeof postMessage>;
    expect(message.id).toBe("2");
    const response = await call(app, "GET", "/events?after=0");
    expect(response.status).toBe(200);
    const page = (await response.json()) as OutputOf<typeof readEvents>;
    expect(page).toEqual({
      cursor: "2",
      events: [
        {
          cursor: "2",
          type: "message.posted",
          createdAt: "2023-11-14T22:13:20.000Z",
          payload: expect.objectContaining({ channel: "dev", text: "hello", thread: "2" }),
          message,
        },
      ],
    });
    const resumed = await call(app, "GET", `/events?after=${page.cursor}`);
    expect(await resumed.json()).toEqual({ events: [], cursor: "2" });
    const atHead = await call(app, "GET", "/events");
    expect(await atHead.json()).toEqual({ events: [], cursor: "2" });
  } finally {
    await app.close();
  }
});

test("validates upstream wait bounds and reads available events immediately", async () => {
  const app = makeApp({ schedule: () => () => {} });
  try {
    await call(app, "POST", "/messages", { channel: "dev", text: "hello" });
    const atHead = await call(app, "GET", "/events?after=2&channel=dev&wait=0");
    expect(atHead.status).toBe(200);
    const page = await atHead.json();
    expect(page).toEqual({ cursor: "2", events: [] });
    for (const wait of ["0.5", "300"]) {
      const response = await call(app, "GET", `/events?after=0&channel=dev&wait=${wait}`);
      expect(response.status).toBe(200);
      expect(((await response.json()) as OutputOf<typeof readEvents>).events).toHaveLength(1);
    }
    for (const wait of ["-0.1", "300.1"]) {
      const response = await call(app, "GET", `/events?after=2&channel=dev&wait=${wait}`);
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: ErrorBody }).error.code).toBe("invalid_request");
    }
  } finally {
    await app.close();
  }
});

function waitingApp(options: Parameters<typeof makeApp>[0] = {}) {
  const timer = Promise.withResolvers<{ delay: number; expire: () => void }>();
  let cancelled = false;
  const app = makeApp({
    ...options,
    schedule(delay, expire) {
      timer.resolve({ delay, expire });
      return () => {
        cancelled = true;
      };
    },
  });
  return { app, armed: timer.promise, cancelled: () => cancelled };
}

test("waits for a matching committed post after scanning an unrelated post", async () => {
  const { app, armed, cancelled } = waitingApp();
  try {
    const pending = call(app, "GET", "/events?after=0&channel=dev&wait=30");
    expect((await armed).delay).toBe(30_000);
    expect((await call(app, "POST", "/messages", { channel: "other", text: "outside" })).status).toBe(201);
    expect(cancelled()).toBe(false);
    expect((await call(app, "POST", "/messages", { channel: "dev", text: "hi" })).status).toBe(201);
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      cursor: "3",
      events: [expect.objectContaining({ type: "message.posted", message: expect.objectContaining({ text: "hi" }) })],
    });
    expect(cancelled()).toBe(true);
  } finally {
    await app.close();
  }
}, 500);

test("starts at head without after and returns an empty page at the capped deadline", async () => {
  const { app, armed, cancelled } = waitingApp();
  try {
    expect((await call(app, "POST", "/messages", { channel: "dev", text: "before the poll" })).status).toBe(201);
    const pending = call(app, "GET", "/events?channel=dev&wait=300");
    const { delay, expire } = await armed;
    expect(delay).toBe(120_000);
    expire();
    expect(await (await pending).json()).toEqual({ cursor: "2", events: [] });
    expect(cancelled()).toBe(true);
  } finally {
    await app.close();
  }
}, 500);

test("cancels the event wait when the request aborts", async () => {
  const { app, armed, cancelled } = waitingApp();
  try {
    const controller = new AbortController();
    const pending = app.fetch(
      new Request(`${BOARD_URL}/events?after=0&wait=30`, {
        headers: { authorization: `Bearer ${OWNER.token}` },
        signal: controller.signal,
      }),
    );
    await armed;
    controller.abort();
    expect(await (await pending).json()).toEqual({ cursor: "0", events: [] });
    expect(cancelled()).toBe(true);
  } finally {
    await app.close();
  }
}, 500);

test("a parked feed refuses a credential rotated before a matching post", async () => {
  const { app, armed } = waitingApp();
  try {
    const created = await call(app, "POST", "/x/connections", {
      name: "feed-reader",
      direct: true,
      can: { dev: ["read"] },
    });
    expect(created.status).toBe(201);
    const { connection, secret } = (await created.json()) as CreatedConnection;
    const pending = app.fetch(
      new Request(`${BOARD_URL}/events?after=0&channel=dev&wait=30`, {
        headers: { authorization: `Bearer ${secret}` },
      }),
    );
    await armed;
    expect((await call(app, "POST", `/x/connections/${connection.id}/rotate`)).status).toBe(200);
    expect((await call(app, "POST", "/messages", { channel: "dev", text: "private" })).status).toBe(201);
    const response = await pending;
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "unauthorized" } });
  } finally {
    await app.close();
  }
}, 500);

test("rechecks a named author registered between actor lookup and event scan", async () => {
  const store = openStore(() => NOW);
  const lookedUp = Promise.withResolvers<void>();
  const continueRead = Promise.withResolvers<void>();
  const { app } = waitingApp({
    store: {
      ...store,
      board(scope) {
        const board = store.board(scope);
        return {
          ...board,
          async findFilterActors(...args) {
            const actors = await board.findFilterActors(...args);
            lookedUp.resolve();
            await continueRead.promise;
            return actors;
          },
        };
      },
    },
  });
  try {
    const pending = call(app, "GET", "/events?after=0&channel=dev&by=local-test&wait=30");
    await lookedUp.promise;
    expect((await call(app, "POST", "/messages", { channel: "dev", text: "first by this author" })).status).toBe(201);
    continueRead.resolve();
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ cursor: "2", events: [{ message: { id: "2" } }] });
  } finally {
    continueRead.resolve();
    await app.close();
  }
}, 500);

test.each(["bad", "1"])("rejects invalid event cursor %s", async (cursor) => {
  const app = makeApp();
  try {
    const response = await call(app, "GET", `/events?after=${cursor}`);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: ErrorBody }).error.code).toBe("invalid_cursor");
  } finally {
    await app.close();
  }
});

test("filters the feed by historical message and root labels across the cursor", async () => {
  const app = makeApp();
  try {
    expect(
      (
        await call(app, "POST", "/messages", {
          channel: "dev",
          text: "root",
          labels: { status: "open" },
        })
      ).status,
    ).toBe(201);
    expect((await call(app, "POST", "/messages", { re: "2", text: "Reply 100%_done" })).status).toBe(201);
    expect((await call(app, "POST", "/messages/2/labels", { set: { status: "closed" } })).status).toBe(200);
    expect((await call(app, "POST", "/messages", { re: "2", text: "too late" })).status).toBe(201);
    expect(
      (
        await call(app, "POST", "/messages", {
          channel: "dev/web",
          text: "child",
          labels: { status: "open" },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await call(app, "POST", "/messages", {
          channel: "other",
          text: "outside",
          labels: { status: "open" },
        })
      ).status,
    ).toBe(201);

    const read = async (query: string) => {
      const response = await call(app, "GET", `/events?${query}`);
      expect(response.status).toBe(200);
      const page = (await response.json()) as OutputOf<typeof readEvents>;
      return { events: page.events.map(({ cursor, type }) => [cursor, type]), cursor: page.cursor };
    };
    expect(await read("after=0&channel=dev&label=status=open")).toEqual({
      events: [
        ["2", "message.posted"],
        ["3", "message.posted"],
        ["4", "labels.changed"],
      ],
      cursor: "7",
    });
    expect(await read("after=3&channel=dev/&label=status=open")).toEqual({
      events: [
        ["4", "labels.changed"],
        ["6", "message.posted"],
      ],
      cursor: "7",
    });
    expect(await read("after=0&re=2&label=status=open&text=100%25_&by=me&from=board")).toEqual({
      events: [["3", "message.posted"]],
      cursor: "7",
    });
    expect(await read("after=0&by=LOCAL-TEST&re=2&text=reply")).toEqual({
      events: [["3", "message.posted"]],
      cursor: "7",
    });
  } finally {
    await app.close();
  }
});

test("an edit that removes matching text and mentions is still delivered after the original post cursor", async () => {
  const app = makeApp();
  try {
    expect((await call(app, "POST", "/messages", { channel: "dev", text: "hello @[someone]" })).status).toBe(201);
    expect((await call(app, "POST", "/messages/2/edit", { text: "goodbye" })).status).toBe(200);
    const response = await call(app, "GET", "/events?after=2&text=HELLO&mentions=%40%5Bsomeone%5D");
    expect(response.status).toBe(200);
    const page = (await response.json()) as OutputOf<typeof readEvents>;
    expect(page.cursor).toBe("3");
    expect(page.events.map(({ type, message }) => [type, message.text])).toEqual([["message.edited", "goodbye"]]);
  } finally {
    await app.close();
  }
});

test("a channel-limited credential reads only events it may see", async () => {
  const app = makeApp();
  try {
    await call(app, "POST", "/messages", { channel: "dev", text: "public @[someone]" });
    await call(app, "POST", "/messages", { channel: "dev/secret", text: "private" });
    const connection = await call(app, "POST", "/x/connections", {
      name: "feed-reader",
      direct: true,
      can: { dev: ["read"] },
    });
    expect(connection.status).toBe(201);
    const { secret } = (await connection.json()) as { secret: string };
    const read = (query: string) =>
      app.fetch(
        new Request(`http://localhost/api/local/main/events?${query}`, {
          headers: { authorization: `Bearer ${secret}` },
        }),
      );
    expect((await read("after=0")).status).toBe(403);
    const response = await read("after=0&channel=dev");
    expect(response.status).toBe(200);
    const page = (await response.json()) as OutputOf<typeof readEvents>;
    expect(page.events.map(({ message }) => message.channel)).toEqual(["dev"]);
    expect(page.events[0]?.message.mentions).toBeUndefined();
    expect((await read("after=0&channel=dev/secret")).status).toBe(403);
  } finally {
    await app.close();
  }
});

test("reads the newest channel events oldest first with current views and resumes from the board head", async () => {
  const app = makeApp();
  try {
    expect((await call(app, "POST", "/messages", { channel: "dev", text: "old text" })).status).toBe(201);
    expect((await call(app, "POST", "/messages", { channel: "dev", text: "second" })).status).toBe(201);
    expect((await call(app, "POST", "/messages/3/edit", { text: "second edited" })).status).toBe(200);
    expect((await call(app, "POST", "/messages/3/edit", { text: "second revised" })).status).toBe(200);
    expect((await call(app, "POST", "/messages", { channel: "dev/web", text: "outside" })).status).toBe(201);

    const response = await call(app, "GET", "/events?channel=dev&last=3");
    expect(response.status).toBe(200);
    const page = (await response.json()) as OutputOf<typeof readEvents>;
    expect(page.cursor).toBe("6");
    expect(page.events.map(({ cursor, message }) => [cursor, message.text])).toEqual([
      ["3", "second revised"],
      ["4", "second revised"],
      ["5", "second revised"],
    ]);
    expect(page.events[0]?.payload).toMatchObject({ text: "second revised" });
    expect(page.events[1]?.payload).toMatchObject({ text: "second revised" });

    const staleText = await call(app, "GET", "/events?channel=dev&last=3&text=second%20edited");
    const filtered = (await staleText.json()) as OutputOf<typeof readEvents>;
    expect(filtered.events.map(({ cursor }) => cursor)).toEqual(["5"]);

    expect((await call(app, "POST", "/messages", { channel: "dev", text: "new" })).status).toBe(201);
    const resumed = await call(app, "GET", `/events?channel=dev&after=${page.cursor}`);
    expect(resumed.status).toBe(200);
    expect(((await resumed.json()) as OutputOf<typeof readEvents>).events.map(({ cursor }) => cursor)).toEqual(["7"]);
  } finally {
    await app.close();
  }
});

test.each(["last=2&after=0", "last=2&wait=0", "last=0", "last=101", "last=1.5"])(
  "rejects invalid newest-event query %s",
  async (query) => {
    const app = makeApp();
    try {
      const response = await call(app, "GET", `/events?${query}`);
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: ErrorBody }).error.code).toBe("invalid_request");
    } finally {
      await app.close();
    }
  },
);
