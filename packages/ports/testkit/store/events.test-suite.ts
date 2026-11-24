import { expect, test } from "bun:test";
import { type ActorSeen, type ChannelCreated, messages } from "@openboard/core";
import { type OpenStore, testScope } from "../index.ts";

export function eventsSuite(driver: string, open: OpenStore): void {
  pagesTest(driver, open);
  bookkeepingTest(driver, open);
}

function pagesTest(driver: string, open: OpenStore): void {
  test(`${driver}: reads a bounded page of events and resumes at the next position`, async () => {
    const store = await open();
    try {
      const keys = await store.platform().findBoard("local", "main");
      if (!keys) throw new Error("the implicit board local/main is missing");
      const board = store.board(testScope(keys));
      const by = { actor: "ob:user:local-test", principal: "ob:user:local-test", profile: null };
      await board.write(async (writer) => {
        const events = Array.from(
          { length: 201 },
          (_, head) =>
            messages.decidePost(
              { head },
              { channel: head < 2 ? "dev" : "dev/web", text: "hello" },
              { by, now: 1_700_000_000_000 },
            ).events[0],
        );
        await writer.append(events);
      });

      const unmatched = await board.readEvents(0, { channel: "ops", labels: [["status", ["open"]]] });
      expect(unmatched).toEqual({ head: 201, cursor: 200, events: [] });

      const recent = await board.readEvents(undefined, { channel: "dev", last: 2 });
      expect(recent.cursor).toBe(201);
      expect(recent.events.map(({ id }) => id)).toEqual([1, 2]);
      const subtree = await board.readEvents(undefined, { channel: "dev/", last: 2 });
      expect(subtree.events.map(({ id }) => id)).toEqual([200, 201]);

      const empty = await board.readEvents(undefined, { channel: "ops", last: 2 });
      expect(empty).toEqual({ head: 201, cursor: 201, events: [] });

      const first = await board.readEvents(0);
      expect(first.cursor).toBe(200);
      expect(first.events.map(({ id }) => id)).toEqual(Array.from({ length: 200 }, (_, index) => index + 1));
      const second = await board.readEvents(first.cursor);
      expect(second.cursor).toBe(201);
      expect(second.events.map(({ id }) => id)).toEqual([201]);
      expect(await board.readEvents(second.cursor)).toEqual({ events: [], cursor: 201, head: 201 });
    } finally {
      await store.close();
    }
  });
}

function bookkeepingTest(driver: string, open: OpenStore): void {
  test(`${driver}: reads bookkeeping events only with all and no filter`, async () => {
    const store = await open();
    try {
      const keys = await store.platform().findBoard("local", "main");
      if (!keys) throw new Error("the implicit board local/main is missing");
      const board = store.board(testScope(keys));
      const by = { actor: "ob:user:local-test", principal: "ob:user:local-test", profile: null };
      const at = 1_700_000_000_000;
      const common = {
        at,
        thread: null,
        message: null,
        actor: by.actor,
        principal: by.principal,
        visibility: 1,
      } as const;
      const seen: ActorSeen = {
        ...common,
        id: 1,
        type: "actor.seen",
        channel: null,
        payload: { actor: by.actor, kind: "person", handle: "local-test", name: "local-test", avatar: null },
      };
      const created: ChannelCreated = {
        ...common,
        id: 2,
        type: "channel.created",
        channel: "dev",
        payload: { channel: "dev", by },
      };
      const posted = messages.decidePost({ head: 2 }, { channel: "dev", text: "hello" }, { by, now: at }).events[0];
      await board.write(async (writer) => {
        await writer.append([seen, created, posted]);
      });

      const ids = async (after: number | undefined, filters: Parameters<typeof board.readEvents>[1]) =>
        (await board.readEvents(after, filters)).events.map(({ id, type }) => [id, type]);
      expect(await ids(0, {})).toEqual([[3, "message.posted"]]);
      expect(await ids(0, { all: true })).toEqual([
        [1, "actor.seen"],
        [2, "channel.created"],
        [3, "message.posted"],
      ]);
      expect((await board.readEvents(0, { all: true })).events[0]).toEqual(seen);
      expect(await ids(undefined, { all: true, last: 2 })).toEqual([
        [2, "channel.created"],
        [3, "message.posted"],
      ]);
      expect(await ids(undefined, { last: 2 })).toEqual([[3, "message.posted"]]);
      expect(await ids(0, { all: true, channel: "dev" })).toEqual([[3, "message.posted"]]);
      expect(await ids(undefined, { all: true, channel: "dev", last: 3 })).toEqual([[3, "message.posted"]]);
    } finally {
      await store.close();
    }
  });
}
