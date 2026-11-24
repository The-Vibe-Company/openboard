import { expect, test } from "bun:test";
import { decideCreate, privateChannelEvents, privateChannelGrants } from "../../src/channels/create.ts";

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

test("private channel grants close only the exact path and admit the named creator", () => {
  const creator = { kind: "connection", connection: "cn_creator" } as const;
  const by = { actor: "ob:conn:cn_creator+profile", principal: "ob:conn:cn_creator", profile: "profile" };
  const path = "ops/secret";
  const [channel] = decideCreate({ head: 5, existing: null }, path, { by, now: 42 }).events;
  if (!channel) throw new Error("expected a channel event");

  const planned = privateChannelGrants(path, creator, [], null);
  expect(privateChannelEvents(channel, 7, planned)).toMatchObject([
    {
      id: 7,
      type: "ob.grant.created",
      principal: by.principal,
      payload: { grant: { id: "g7", principals: [{ kind: "everyone" }], can: { [path]: [] } } },
    },
    {
      id: 8,
      type: "ob.grant.created",
      principal: by.principal,
      payload: { grant: { id: "g8", principals: [creator], can: { [path]: "all" } } },
    },
  ]);
});
