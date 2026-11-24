import { expect, test } from "bun:test";
import { decideEdit, messages } from "@openboard/core";

const principal = "ob:conn:laptop";
const profile = { principal, actor: `${principal}+fixer-2`, profile: "fixer-2" };
const now = 1_700_000_000_000;
const target = messages.decidePost({ head: 0 }, { channel: "dev", text: "original" }, { by: profile, now }).message;
const state = { head: 2, target };
const input = { id: target.id, text: "edited" };

test("a profile can edit its own message", () => {
  expect(decideEdit(state, input, { by: profile, now }).payload.view).toMatchObject({
    text: "edited",
    by: profile,
  });
});

test("an unrelated unprofiled principal cannot edit a message, even with a stale revision", () => {
  const other = "ob:conn:other";
  const by = { principal: other, actor: other, profile: null };
  expect(() => decideEdit(state, { ...input, revision: target.revision + 1 }, { by, now })).toThrow(
    expect.objectContaining({ code: "forbidden" }),
  );
});
