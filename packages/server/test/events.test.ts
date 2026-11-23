import { expect, test } from "bun:test";
import type { ErrorBody, OutputOf, postMessage, readEvents } from "@openboard/contract";
import { call, makeApp } from "./support/app.ts";

test("reads a posted message once from its event cursor", async () => {
  const app = makeApp();
  try {
    const post = await call(app, "POST", "/messages", { channel: "dev", text: "hello" });
    expect(post.status).toBe(201);
    const { message } = (await post.json()) as OutputOf<typeof postMessage>;
    expect(message.id).toBe("1");
    const response = await call(app, "GET", "/events?after=0");
    expect(response.status).toBe(200);
    const page = (await response.json()) as OutputOf<typeof readEvents>;
    expect(page).toEqual({
      cursor: "1",
      events: [
        {
          cursor: "1",
          type: "message.posted",
          createdAt: "2023-11-14T22:13:20.000Z",
          payload: expect.objectContaining({ channel: "dev", text: "hello", thread: "1" }),
          message,
        },
      ],
    });
    const resumed = await call(app, "GET", `/events?after=${page.cursor}`);
    expect(await resumed.json()).toEqual({ events: [], cursor: "1" });
    const atHead = await call(app, "GET", "/events");
    expect(await atHead.json()).toEqual({ events: [], cursor: "1" });
  } finally {
    await app.close();
  }
});

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
