import { expect, test } from "bun:test";
import { decidePost } from "../../src/messages/post.ts";

const by = { actor: "ob:user:local-dev", principal: "ob:user:local-dev", profile: null };
const context = { by, now: 1_700_000_000_000 };
const draft = { channel: "dev", text: "x", id: "draft" };
const sync = ["chat:#incidents"];

test("a new thread with a sync target is refused with a board-only retry", () => {
  expect(() => decidePost({ head: 0 }, { ...draft, sync }, context)).toThrow(
    expect.objectContaining({
      code: "invalid_target",
      message: "This board syncs nowhere.",
      next: [{ kind: "call", operation: "post", input: { ...draft, noSync: true } }],
    }),
  );
});

test.each([
  ["a reply", { re: "2", text: "x", sync }],
  ["a board-only post", { ...draft, noSync: true, sync }],
])("sync targets on %s are an invalid request", (_, command) => {
  expect(() => decidePost({ head: 2 }, command, context)).toThrow(expect.objectContaining({ code: "invalid_request" }));
});

test("an empty target list is equivalent to omitting it", () => {
  const state = { head: 0 };
  expect(decidePost(state, { ...draft, sync: [] }, context)).toEqual(decidePost(state, draft, context));
});
