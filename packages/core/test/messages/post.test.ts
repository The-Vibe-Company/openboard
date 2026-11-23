import { describe, expect, test } from "bun:test";
import { BoardError } from "@openboard/contract";
import { isoTime, parseId } from "../../src/ids.ts";
import { decidePost } from "../../src/messages/post.ts";

const by = { actor: "ob:user:local-dev", principal: "ob:user:local-dev", profile: null };
const at = 1_700_000_000_123;

function refusal(run: () => unknown): { code: string; message: string } {
  try {
    run();
  } catch (error) {
    if (error instanceof BoardError) return { code: error.code, message: error.message };
    throw error;
  }
  throw new Error("expected a BoardError");
}

describe("posting a message", () => {
  test("names the message and its thread by the next log position", () => {
    const { events, message } = decidePost({ head: 0 }, { channel: "dev", text: "hello" }, { by, now: at });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: 1, type: "message.posted", at, thread: 1, message: 1, channel: "dev" });
    expect(events[0].payload).toMatchObject({
      channel: "dev",
      text: "hello",
      re: null,
      thread: "1",
      noSync: false,
      by,
    });
    expect(message).toMatchObject({ id: "1", channel: "dev", text: "hello", re: null, thread: "1", version: 1 });
    expect(message.createdAt).toBe("2023-11-14T22:13:20.123Z");
  });

  test("follows the board's head", () => {
    const { message } = decidePost({ head: 41 }, { channel: "dev", text: "hi", noSync: true }, { by, now: at });
    expect(message).toMatchObject({ id: "42", thread: "42", noSync: true });
  });

  test("keeps the labels it is given", () => {
    const { message } = decidePost(
      { head: 0 },
      { channel: "dev", text: "x", labels: { status: "open" } },
      { by, now: at },
    );
    expect(message.labels).toEqual({ status: "open" });
  });

  test.each([
    ["blank text", { text: "  \n" }, "invalid_request"],
    ["a NUL character", { text: "a\0b" }, "invalid_request"],
    ["a lone surrogate", { text: "a\uD800" }, "invalid_request"],
    ["a label under board.", { text: "x", labels: { "board.task": "open" } }, "reserved_label"],
    ["a control character in a label", { text: "x", labels: { status: "a\nb" } }, "invalid_request"],
  ])("refuses %s", (_, command, code) => {
    expect(refusal(() => decidePost({ head: 0 }, { channel: "dev", ...command }, { by, now: at })).code).toBe(code);
  });
});

describe("replying in a thread", () => {
  const root = { id: 1, channel: "dev", thread: 1 };

  test("joins the root's thread and channel at the next log position", () => {
    const { events, message } = decidePost({ head: 1, target: root }, { re: "1", text: "on it" }, { by, now: at });
    expect(events[0]).toMatchObject({ id: 2, thread: 1, message: 2, channel: "dev" });
    expect(events[0].payload).toMatchObject({ channel: "dev", re: "1", replyTo: null, thread: "1" });
    expect(message).toMatchObject({ id: "2", channel: "dev", text: "on it", re: "1", replyTo: null, thread: "1" });
  });

  test("refuses a reply to a message the board does not have", () => {
    const refused = refusal(() => decidePost({ head: 1, target: null }, { re: "9", text: "x" }, { by, now: at }));
    expect(refused).toEqual({ code: "message_not_found", message: "Couldn't find message #9." });
  });

  test("puts a reply to a reply in the root's thread, and keeps the reply it answered as replyTo", () => {
    const target = { id: 2, channel: "dev", thread: 1 };
    const { events, message } = decidePost({ head: 2, target }, { re: "2", text: "deeper" }, { by, now: at });
    expect(events[0]).toMatchObject({ id: 3, thread: 1, message: 3, channel: "dev" });
    expect(events[0].payload).toMatchObject({ channel: "dev", re: "1", replyTo: "2", thread: "1" });
    expect(message).toMatchObject({ id: "3", channel: "dev", text: "deeper", re: "1", replyTo: "2", thread: "1" });
  });

  test.each([
    ["both channel and re", { channel: "dev", re: "1" }, "channel"],
    ["neither channel nor re", {}, "channel"],
  ])("refuses a post with %s", (_, place, field) => {
    const refused = refusal(() => decidePost({ head: 1, target: root }, { ...place, text: "x" }, { by, now: at }));
    expect(refused.code).toBe("invalid_request");
    expect(refused.message).toStartWith(field);
  });
});

describe("recording who writes", () => {
  const author = { kind: "person", handle: "local-dev", name: "local-dev", avatar: null } as const;
  const known = { id: by.actor, ...author };

  test("writes actor.seen before an actor's first post, which takes the position after it", () => {
    const { events, message } = decidePost(
      { head: 4, actor: null },
      { channel: "dev", text: "hi" },
      { by, author, now: at },
    );
    expect(events.map((event) => [event.id, event.type])).toEqual([
      [5, "actor.seen"],
      [6, "message.posted"],
    ]);
    expect(events[0]).toMatchObject({ at, actor: by.actor, principal: by.principal, visibility: 1, channel: null });
    expect(events[0].payload).toEqual({
      actor: by.actor,
      kind: "person",
      handle: "local-dev",
      name: "local-dev",
      avatar: null,
    });
    expect(message).toMatchObject({ id: "6", thread: "6" });
  });

  test("writes nothing more for an actor the board already shows as it is", () => {
    const { events } = decidePost(
      { head: 6, actor: known },
      { channel: "dev", text: "again" },
      { by, author, now: at },
    );
    expect(events.map((event) => [event.id, event.type])).toEqual([[7, "message.posted"]]);
  });

  test("writes actor.seen again when the actor shows otherwise", () => {
    const renamed = { ...known, name: "Dev" };
    const { events } = decidePost(
      { head: 6, actor: renamed },
      { channel: "dev", text: "again" },
      { by, author, now: at },
    );
    expect(events.map((event) => event.type)).toEqual(["actor.seen", "message.posted"]);
  });

  test("writes no actor.seen when the board's record of the writer was not read", () => {
    const { events } = decidePost({ head: 0 }, { channel: "dev", text: "hi" }, { by, author, now: at });
    expect(events.map((event) => event.type)).toEqual(["message.posted"]);
  });

  test("records a profile with the principal it acts through", () => {
    const agent = { kind: "agent", handle: "local-dev/fixer", name: "Fixer", avatar: null } as const;
    const via = { name: "local-dev", environment: null };
    const { events } = decidePost(
      { head: 0, actor: null },
      { channel: "dev", text: "hi" },
      { by: { ...by, actor: `${by.actor}+fixer`, profile: "fixer" }, author: { ...agent, via }, now: at },
    );
    expect(events[0].payload).toEqual({ actor: `${by.actor}+fixer`, ...agent, via });
  });

  test("writes no actor.seen for a refused post", () => {
    const refused = refusal(() =>
      decidePost({ head: 0, actor: null }, { channel: "dev", text: " " }, { by, author, now: at }),
    );
    expect(refused.code).toBe("invalid_request");
  });
});

describe("wire IDs and times", () => {
  test.each([
    ["1", 1],
    ["812", 812],
    ["0", 0],
    ["01", null],
    ["-1", null],
    ["1.5", null],
    ["abc", null],
  ])("reads %p as %p", (text, position) => {
    expect(parseId(text)).toBe(position);
  });

  test.each([
    [0, "1970-01-01T00:00:00.000Z"],
    [951_782_400_000, "2000-02-29T00:00:00.000Z"],
    [1_798_761_599_999, "2026-12-31T23:59:59.999Z"],
  ])("formats %p as %p", (ms, iso) => {
    expect(isoTime(ms)).toBe(iso);
  });
});
