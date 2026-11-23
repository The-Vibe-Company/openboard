import { expect, test } from "bun:test";
import { decideEdit, messages } from "@openboard/core";

const by = { actor: "ob:user:local-dev", principal: "ob:user:local-dev", profile: null };
const now = 1_700_000_000_000;
const target = messages.decidePost({ head: 0 }, { channel: "dev", text: "old text" }, { by, now }).message;

test.each(["", " \n ", "text\0", "\ud800"])("refuses invalid replacement text %j", (text) => {
  expect(() => decideEdit({ head: 1, target }, { id: "1", text }, { by, now })).toThrow(
    expect.objectContaining({ code: "invalid_request" }),
  );
});

test("refuses to edit a deleted message", () => {
  const deleted = { ...target, deleted: true };
  expect(() => decideEdit({ head: 2, target: deleted }, { id: "1", text: "new text" }, { by, now })).toThrow(
    expect.objectContaining({ code: "message_deleted" }),
  );
});
