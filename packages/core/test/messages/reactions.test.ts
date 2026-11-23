import { expect, test } from "bun:test";
import { canonicalEmoji, decideReaction, messages } from "@openboard/core";

const by = { actor: "ob:user:local-dev", principal: "ob:user:local-dev", profile: null };
const other = { actor: "ob:user:other", principal: "ob:user:other", profile: null };
const now = 1_700_000_000_000;
const target = messages.decidePost({ head: 0 }, { channel: "dev", text: "hello" }, { by, now }).message;

test("a reaction adds the reacting actor under the emoji and raises the version", () => {
  const [event] = decideReaction({ head: 4, target }, { id: "1", emoji: "eyes" }, { by, now });
  expect(event).toMatchObject({ id: 5, type: "reaction.added", message: 1, thread: 1, actor: by.actor });
  expect(event?.type === "reaction.added" && event.payload.view).toMatchObject({
    reactions: { eyes: [by.actor] },
    version: 5,
    revision: target.revision,
  });
});

test("a second actor joins the list after the first", () => {
  const reacted = { ...target, reactions: { eyes: [other.actor] } };
  const [event] = decideReaction({ head: 2, target: reacted }, { id: "1", emoji: "eyes" }, { by, now });
  expect(event?.type === "reaction.added" && event.payload.view.reactions).toEqual({ eyes: [other.actor, by.actor] });
});

test("a reaction the actor already holds appends nothing", () => {
  const reacted = { ...target, reactions: { eyes: [by.actor] } };
  expect(decideReaction({ head: 2, target: reacted }, { id: "1", emoji: "eyes" }, { by, now })).toEqual([]);
});

test("a removal clears the last reaction under its canonical emoji name", () => {
  const reacted = { ...target, reactions: { thumbs_up: [by.actor], eyes: [by.actor] } };
  const [event] = decideReaction({ head: 4, target: reacted }, { id: "1", emoji: "+1", remove: true }, { by, now });
  expect(event).toMatchObject({
    id: 5,
    type: "reaction.removed",
    actor: by.actor,
    payload: { emoji: "thumbs_up" },
  });
  expect(event?.type === "reaction.removed" && event.payload.view.reactions).toEqual({ eyes: [by.actor] });
  expect(reacted.reactions.thumbs_up).toEqual([by.actor]);
});

test("removing a reaction the actor does not hold appends no reaction event", () => {
  const reacted = { ...target, reactions: { eyes: [other.actor] } };
  expect(decideReaction({ head: 2, target: reacted }, { id: "1", emoji: "eyes", remove: true }, { by, now })).toEqual(
    [],
  );
});

test("an unseen writer is recorded with actor.seen before its reaction", () => {
  const author = { kind: "person" as const, handle: "local-dev", name: "Local Dev", avatar: null };
  const events = decideReaction({ head: 3, target, actor: null }, { id: "1", emoji: "eyes" }, { by, author, now });
  expect(events.map((event) => [event.id, event.type])).toEqual([
    [4, "actor.seen"],
    [5, "reaction.added"],
  ]);
});

test("an alias is stored as its canonical name", () => {
  expect(canonicalEmoji("+1")).toBe("thumbs_up");
  expect(canonicalEmoji("eyes")).toBe("eyes");
  expect([canonicalEmoji("sob"), canonicalEmoji("cry")]).toEqual(["cry", "cry"]);
});

test.each(["", "Eyes", ":eyes:", "👀", "constructor", "__proto__", "prototype", "a".repeat(65)])(
  "refuses the emoji %j",
  (emoji) => {
    expect(() => decideReaction({ head: 1, target }, { id: "1", emoji }, { by, now })).toThrow(
      expect.objectContaining({ code: "invalid_request" }),
    );
  },
);

test("refuses a missing or deleted message", () => {
  expect(() => decideReaction({ head: 1, target: null }, { id: "9", emoji: "eyes" }, { by, now })).toThrow(
    expect.objectContaining({ code: "message_not_found" }),
  );
  const deleted = { ...target, deleted: true };
  expect(() => decideReaction({ head: 2, target: deleted }, { id: "1", emoji: "eyes" }, { by, now })).toThrow(
    expect.objectContaining({ code: "message_deleted" }),
  );
});
