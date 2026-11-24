import { expect, test } from "bun:test";
import { decideLabels, matchesWebhookFilter, messages, parseTail } from "../../src/index.ts";

test("matches a label transition out of the tail unless event types exclude it", () => {
  const context = { now: 0, by: { actor: "owner", principal: "owner", profile: null } };
  const initial = messages.decidePost(
    { head: 0 },
    { channel: "dev", text: "fixture", labels: { status: "ready" } },
    context,
  );
  const posted = initial.events.find((event) => event.type === "message.posted");
  if (posted?.type !== "message.posted") throw new Error("missing post");
  const previous = messages.messageView(posted);
  const changed = decideLabels(
    { head: posted.id, target: previous },
    { id: previous.id, unset: ["status"] },
    context,
  ).find((event) => event.type === "labels.changed");
  if (changed?.type !== "labels.changed") throw new Error("missing label event");

  const tail = "dev --label status=ready";
  const resolved = parseTail(tail);
  expect(matchesWebhookFilter({ tail }, changed, resolved, previous, undefined)).toBe(true);
  expect(matchesWebhookFilter({ tail, types: ["message.posted"] }, changed, resolved, previous, undefined)).toBe(false);
});
