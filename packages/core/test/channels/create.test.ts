import { expect, test } from "bun:test";
import { decideCreate } from "../../src/channels/create.ts";

test("leaves an existing channel's counts and log position intact", () => {
  const existing = { path: "dev/alerts", lastIndex: 3, messages: 2, threads: 1 };
  const by = { actor: "ob:user:local-test", principal: "ob:user:local-test", profile: null };

  expect(decideCreate({ head: 5, existing }, existing.path, { by, now: 0 })).toEqual({
    channel: existing,
    created: false,
    events: [],
  });
});

test("writes one bookkeeping event at the next position for a new channel", () => {
  const by = { actor: "ob:user:local-test", principal: "ob:user:local-test", profile: null };
  expect(decideCreate({ head: 5, existing: null }, "dev/alerts", { by, now: 42 }).events).toEqual([
    {
      id: 6,
      type: "channel.created",
      at: 42,
      thread: null,
      message: null,
      channel: "dev/alerts",
      actor: by.actor,
      principal: by.principal,
      visibility: 1,
      payload: { channel: "dev/alerts", by },
    },
  ]);
});
