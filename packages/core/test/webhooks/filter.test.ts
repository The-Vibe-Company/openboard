import { expect, test } from "bun:test";
import { decideCreateTask, decideLabels, matchesWebhookFilter, messages, parseTail } from "../../src/index.ts";
import { validateWebhookFilter } from "../../src/webhooks/filter.ts";

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

test("matches only the event that changes the root task to ready in one append", () => {
  const context = { now: 0, by: { actor: "owner", principal: "owner", profile: null } };
  const { events, task } = decideCreateTask({ head: 0 }, { channel: "work/fix", text: "fixture" }, context);
  const created = events.find((event) => event.type === "task.created");
  if (!created) throw new Error("missing task creation");
  const changed = decideLabels(
    { head: created.id, target: task },
    { id: task.id, set: { priority: "high" } },
    context,
  ).find((event) => event.type === "labels.changed");
  if (!changed) throw new Error("missing label event");

  const filter = { tail: "work/", became: { task: "ready" } };
  const resolved = validateWebhookFilter(filter);
  const match = (types: string[]) => [
    matchesWebhookFilter({ ...filter, types }, created, resolved, undefined, undefined),
    matchesWebhookFilter({ ...filter, types }, changed, resolved, task, undefined),
  ];
  expect(match(["task.created", "labels.changed"])).toEqual([true, false]);
  expect(match(["labels.changed"])).toEqual([false, false]);
});

test.each([{ task: "unknown" }, { task: "ready", label: "ready" }])(
  "rejects unsupported became conditions: %j",
  (became) => {
    expect(() => validateWebhookFilter({ tail: "work/", became })).toThrow(
      expect.objectContaining({ code: "invalid_request" }),
    );
  },
);
