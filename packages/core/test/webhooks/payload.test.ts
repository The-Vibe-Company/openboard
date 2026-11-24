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
