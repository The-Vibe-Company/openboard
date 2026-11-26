import { expect, mock, test } from "bun:test";
import type { Client } from "@the-vibe-company/openboard";
import { readThreadDetail, shareThreadDetail, type ThreadMessage, threadTailSize } from "../src/api/thread.ts";

function messages(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index + 2),
    text: `Reply ${index + 1}`,
    mentions: [],
    blocks: [],
    reactions: {},
  })) as unknown as ThreadMessage[];
}

function fixture(replies: ThreadMessage[]) {
  const message = { id: "1" } as ThreadMessage;
  const readThread = mock<Client["readThread"]>(async ({ after, limit }) => ({
    message,
    replies: after
      ? replies.filter(({ id }) => Number(id) > Number(after)).slice(0, limit)
      : replies.slice(-(limit ?? replies.length)),
    schedules: [],
    cursor: "999",
  }));
  return { readThread };
}

test("initial and live reads use one bounded tail request and detect older replies", async () => {
  const replies = messages(52);
  const client = fixture(replies);
  const signal = new AbortController().signal;
  for (const id of ["1", "4"]) {
    const detail = await readThreadDetail(client, id, false, signal);
    expect(detail.replies).toEqual(replies.slice(-50));
    expect(detail.hasOlder).toBe(true);
  }
  expect(client.readThread.mock.calls).toEqual([
    [{ id: "1", limit: 51 }, { signal }],
    [{ id: "4", limit: 51 }, { signal }],
  ]);
});

test("an exactly full tail has no older replies", async () => {
  const replies = messages(threadTailSize);
  const detail = await readThreadDetail(fixture(replies), "1", false, new AbortController().signal);
  expect(detail.replies).toEqual(replies);
  expect(detail.hasOlder).toBe(false);
});

test.each([
  ["1", true],
  ["2", false],
] as const)("expanded history and old reply deep links read past the API page limit (%s)", async (id, showHistory) => {
  const replies = messages(552);
  const client = fixture(replies);
  const signal = new AbortController().signal;
  const detail = await readThreadDetail(client, id, showHistory, signal);
  expect(detail.message.id).toBe("1");
  expect(detail.replies).toEqual(replies);
  expect(detail.hasOlder).toBe(false);
  expect(client.readThread.mock.calls).toEqual([
    [{ id, limit: 51 }, { signal }],
    [{ id: "1", after: "1", limit: 500 }, { signal }],
    [{ id: "1", after: "501", limit: 500 }, { signal }],
  ]);
});

test("a sliding tail reuses unchanged rows and a reaction preserves Markdown inputs", async () => {
  const replies = messages(52);
  const signal = new AbortController().signal;
  const before = await readThreadDetail(fixture(replies.slice(0, -1)), "1", false, signal);
  const after = await readThreadDetail(fixture(structuredClone(replies)), "1", false, signal);
  const reacted = after.replies[0];
  const original = before.replies[1];
  if (!reacted || !original) throw new Error("Expected overlapping tails");
  reacted.reactions.eyes = ["ada"];
  const shared = shareThreadDetail(before, after);
  expect(shared.replies[1]).toBe(before.replies[2]);
  expect(shared.replies[0]).not.toBe(original);
  expect(shared.replies[0]?.reactions).toEqual({ eyes: ["ada"] });
  expect(shared.replies[0]?.mentions).toBe(original.mentions);
  expect(shared.replies[0]?.blocks).toBe(original.blocks);
});
