import { expect, test } from "bun:test";
import { messages, webhookPayload } from "../../src/index.ts";

test("webhook payload truncates on a UTF-8 boundary and marks the shortened body", () => {
  const { events } = messages.decidePost(
    { head: 0 },
    { channel: "dev", text: "fixture" },
    { now: 0, by: { actor: "owner", principal: "owner", profile: null } },
  );
  const posted = events.find((event) => event.type === "message.posted");
  if (posted?.type !== "message.posted") throw new Error("missing post");
  const text = "𐐷".repeat(70_000);
  const message = { ...messages.messageView(posted), text };
  const delivery = { id: "dl_example", attempt: 1, webhook: "wh_example", name: "test" };
  const body = webhookPayload(
    "http://localhost",
    "local",
    "main",
    delivery,
    { message, payload: { text } },
    { ...message, text: "" },
  );
  if (!body) throw new Error("missing encoded body");
  const { truncated, event } = JSON.parse(body);
  expect(truncated).toBe(true);
  expect(event.message.text).toBe(event.payload.text);
  expect(event.message.text.isWellFormed()).toBe(true);
  expect(Buffer.byteLength(body)).toBeLessThanOrEqual(256 * 1024);
  expect(Buffer.byteLength(body)).toBeGreaterThan(256 * 1024 - 8);
});

test("reserves space for attempt 10 without changing the delivery text", () => {
  const { events } = messages.decidePost(
    { head: 0 },
    { channel: "dev", text: "fixture" },
    { now: 0, by: { actor: "owner", principal: "owner", profile: null } },
  );
  const posted = events.find((event) => event.type === "message.posted");
  if (posted?.type !== "message.posted") throw new Error("missing post");
  const render = (attempt: number, text: string) => {
    const message = { ...messages.messageView(posted), text };
    const delivery = { id: "dl_example", attempt, webhook: "wh_example", name: "test" };
    const body = webhookPayload("http://localhost", "local", "main", delivery, { message, payload: {} }, message);
    if (!body) throw new Error("missing encoded body");
    return body;
  };
  const text = "a".repeat(256 * 1024 - Buffer.byteLength(render(1, "")));
  const first = render(1, text);
  const last = render(10, text);
  expect(last).toBe(first.replace('"attempt":1', '"attempt":10'));
  expect(Buffer.byteLength(last)).toBe(256 * 1024);
});

test("webhook subject uses the event message's schedule even when it differs from the thread root", () => {
  const { events } = messages.decidePost(
    { head: 0 },
    { channel: "dev", text: "fixture" },
    { now: 0, by: { actor: "owner", principal: "owner", profile: null } },
  );
  const posted = events.find((event) => event.type === "message.posted");
  if (posted?.type !== "message.posted") throw new Error("missing post");
  const root = { ...messages.messageView(posted), schedule: { id: "s1", n: 0 } };
  const delivery = { id: "dl_example", attempt: 1, webhook: "wh_example", name: "test" };
  const slot = { id: "s2", n: 1 };
  for (const schedule of [slot, undefined]) {
    const message = { ...root, id: "3", re: root.id, schedule };
    const body = webhookPayload("http://localhost", "local", "main", delivery, { message, payload: {} }, root);
    if (!body) throw new Error("missing encoded body");
    expect(JSON.parse(body).subject).toMatchObject({
      thread: root.id,
      message: message.id,
      schedule: schedule ?? null,
    });
  }
});
