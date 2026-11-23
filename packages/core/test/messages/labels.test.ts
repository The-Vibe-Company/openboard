import { expect, test } from "bun:test";
import { BoardError } from "@openboard/contract";
import { decideLabels, messages } from "@openboard/core";
import { checkLabels } from "../../src/messages/labels.ts";

function refusal(labels: Record<string, string>): string | null {
  try {
    checkLabels(labels);
    return null;
  } catch (error) {
    if (error instanceof BoardError) return error.code;
    throw error;
  }
}

test.each([
  ["a plain key and value", { status: "open" }],
  ["keys with digits, dots, underscores and dashes", { "ci.run_2-x": "a", "9lives": "b" }],
  ["a 64-character key and a 256-character value", { ["k".repeat(64)]: "v".repeat(256) }],
  ["an empty value", { status: "" }],
  ["a value with spaces and non-ASCII text", { note: "déployé à 9h 🚀" }],
])("takes %s", (_, labels) => {
  expect(refusal(labels)).toBeNull();
});

test.each([
  ["a key under board.", { "board.task": "open" }, "reserved_label"],
  ["the key constructor", { constructor: "x" }, "invalid_request"],
  ["the key prototype", { prototype: "x" }, "invalid_request"],
  ["an uppercase key", { Status: "open" }, "invalid_request"],
  ["a key starting with a dot", { ".status": "open" }, "invalid_request"],
  ["an empty key", { "": "open" }, "invalid_request"],
  ["a 65-character key", { ["k".repeat(65)]: "open" }, "invalid_request"],
  ["a 257-character value", { status: "v".repeat(257) }, "invalid_request"],
  ["a newline in a value", { status: "a\nb" }, "invalid_request"],
  ["a NUL in a value", { status: "a\0b" }, "invalid_request"],
  ["a lone surrogate in a value", { status: "a\uD800" }, "invalid_request"],
])("refuses %s", (_, labels, code) => {
  expect(refusal(labels)).toBe(code);
});

const by = { actor: "ob:user:local-dev", principal: "ob:user:local-dev", profile: null };
const now = 1_700_000_000_000;
const target = messages.decidePost(
  { head: 0 },
  { channel: "dev", text: "hi", labels: { a: "1" } },
  { by, now },
).message;

test("a label write merges its labels into the message's and raises the version to its event", () => {
  const [event] = decideLabels({ head: 4, target }, { id: "1", set: { status: "done", a: "2" } }, { by, now });
  expect(event).toMatchObject({ id: 5, type: "labels.changed", message: 1, thread: 1, channel: "dev" });
  expect(event?.type === "labels.changed" && event.payload).toMatchObject({
    id: "1",
    thread: "1",
    set: { status: "done", a: "2" },
    unset: [],
    view: { labels: { a: "2", status: "done" }, version: 5, revision: target.revision },
  });
  expect(target.labels).toEqual({ a: "1" });
});

test("a label write that changes no value still appends its event", () => {
  expect(decideLabels({ head: 2, target }, { id: "1", set: { a: "1" } }, { by, now })).toHaveLength(1);
});

test("an unseen writer is recorded with actor.seen before its label write", () => {
  const author = { kind: "person", handle: "dev", name: "Dev", avatar: null } as const;
  const events = decideLabels({ head: 2, target, actor: null }, { id: "1", set: { a: "2" } }, { by, author, now });
  expect(events.map((event) => [event.type, event.id])).toEqual([
    ["actor.seen", 3],
    ["labels.changed", 4],
  ]);
});

test.each([
  ["a missing message", null, { a: "2" }, "message_not_found"],
  ["a deleted message", { ...target, deleted: true }, { a: "2" }, "message_deleted"],
  ["a label under board.", target, { "board.task": "open" }, "reserved_label"],
  ["a malformed key", target, { A: "x" }, "invalid_request"],
])("refuses %s", (_, message, set, code) => {
  expect(() => decideLabels({ head: 2, target: message }, { id: "1", set }, { by, now })).toThrow(
    expect.objectContaining({ code }),
  );
});
