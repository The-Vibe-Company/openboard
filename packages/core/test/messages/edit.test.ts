import { expect, test } from "bun:test";
import { decideEdit, decideMakeTask, holdTaskAfterEdit, messages } from "@openboard/core";

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

const fixer = { ...by, actor: "ob:user:local-dev:fixer", profile: "fixer" };
const ownerProfile = { ...by, actor: "ob:user:local-dev:owner", profile: "owner" };
const posted = messages.decidePost({ head: 0 }, { channel: "dev", text: "work" }, { by: fixer, now }).message;
const root = decideMakeTask({ head: 1, target: posted }, posted.id, { by: ownerProfile, now }).task;

test.each(["waiting", "ready", "claimed"] as const)("a non-owner's root edit holds a %s task", (state) => {
  const target = { ...root, task: { ...root.task, state } };
  const edit = decideEdit({ head: 10, target }, { id: root.id, text: "new text" }, { by: fixer, now });
  expect(holdTaskAfterEdit(edit)).toMatchObject({
    id: 12,
    type: "task.blocked",
    payload: {
      kind: "edited",
      by: fixer,
      view: {
        text: "new text",
        revision: edit.payload.view.revision,
        version: 12,
        task: { state: "blocked", claim: null },
        labels: { "board.task": "blocked" },
      },
    },
  });
});

test.each(["blocked", "failed", "completed", "canceled"] as const)("editing a %s task keeps its state", (state) => {
  const target = { ...root, task: { ...root.task, state } };
  const edit = decideEdit({ head: 10, target }, { id: root.id, text: "new text" }, { by: fixer, now });
  expect(holdTaskAfterEdit(edit)).toBeNull();
});

test("an edit by the principal acting as itself does not hold its profile’s task", () => {
  const edit = decideEdit({ head: 10, target: root }, { id: root.id, text: "new text" }, { by, now });
  expect(holdTaskAfterEdit(edit)).toBeNull();
});
