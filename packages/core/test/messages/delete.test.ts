import { expect, test } from "bun:test";
import { decideDelete, messages } from "@openboard/core";

const by = { actor: "ob:user:writer", principal: "ob:user:writer", profile: null };
const profile = { ...by, actor: "ob:user:writer:agent", profile: "agent" };
const now = 1_700_000_000_000;
const target = messages.decidePost({ head: 0 }, { channel: "dev", text: "old text" }, { by: profile, now }).message;

test.each([by, profile])("allows the author or the author's unprofiled principal to delete", (author) => {
  const state = { head: 2, target };
  const event = decideDelete(state, { id: target.id }, { by: author, now });
  expect(event?.payload.view).toMatchObject({ id: target.id, by: target.by, deleted: true, text: "" });
});

test("checks the principal before treating a deleted message as a no-op", () => {
  const other = { actor: "ob:user:other", principal: "ob:user:other", profile: null };
  const state = { head: 2, target: { ...target, deleted: true } };
  expect(() => decideDelete(state, { id: target.id }, { by: other, now })).toThrow(
    expect.objectContaining({ code: "forbidden" }),
  );
});
