import { expect, test } from "bun:test";
import { call, makeApp } from "../support/app.ts";

const target = "chat:#incidents";
const draft = { channel: "dev", text: "x" };

test("posting sync targets is refused without writing a message or an event", async () => {
  const app = makeApp();
  try {
    for (const sync of [[target], [{ target, kind: "channel" }]]) {
      const response = await call(app, "POST", "/messages", { ...draft, sync });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: {
          code: "invalid_target",
          message: "This board syncs nowhere.",
          next: [{ kind: "call", operation: "post", input: { ...draft, noSync: true } }],
        },
      });
    }
    const events = await call(app, "GET", "/events?after=0&all=true");
    expect(events.status).toBe(200);
    expect(await events.json()).toEqual({ events: [], cursor: "0" });
    const messages = await call(app, "GET", "/messages?channel=dev");
    expect(messages.status).toBe(200);
    expect(await messages.json()).toEqual({ messages: [], cursor: "0" });
  } finally {
    await app.close();
  }
});

test("an empty target list posts, while a reply or noSync with targets is invalid", async () => {
  const app = makeApp();
  try {
    const posted = await call(app, "POST", "/messages", { ...draft, sync: [] });
    expect(posted.status).toBe(201);
    const { message } = (await posted.json()) as { message: { id: string } };
    expect(message).toMatchObject({ ...draft, id: "2" });

    for (const body of [
      { re: message.id, text: "reply", sync: [target] },
      { ...draft, noSync: true, sync: [target] },
      { ...draft, sync: Array.from({ length: 11 }, () => target) },
    ]) {
      const response = await call(app, "POST", "/messages", body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "invalid_request" } });
    }
    const events = await call(app, "GET", "/events?after=2&all=true");
    expect(events.status).toBe(200);
    expect(await events.json()).toEqual({ events: [], cursor: "2" });
  } finally {
    await app.close();
  }
});
