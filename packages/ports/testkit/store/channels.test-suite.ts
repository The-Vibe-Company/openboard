import { expect, test } from "bun:test";
import { messages } from "@openboard/core";
import { type OpenStore, testScope } from "../index.ts";

export function channelsSuite(driver: string, open: OpenStore): void {
  test(`${driver}: lists channel counts and the board head in path order`, async () => {
    const store = await open();
    try {
      const keys = await store.platform().findBoard("local", "main");
      if (!keys) throw new Error("the implicit board local/main is missing");
      const board = store.board(testScope(keys));
      expect(await board.listChannels({ limit: 10 })).toEqual({ channels: [], head: 0 });

      const by = { actor: "ob:user:local-dev", principal: "ob:user:local-dev", profile: null };
      for (const channel of ["dev/web", "dev", "dev"]) {
        await board.write(async (writer) => {
          const { events } = messages.decidePost(
            { head: writer.head },
            { channel, text: "hello" },
            { by, now: 1_700_000_000_000 },
          );
          await writer.append(events);
        });
      }

      expect(await board.listChannels({ limit: 10 })).toEqual({
        channels: [
          { path: "dev", lastIndex: 3, messages: 2, threads: 2 },
          { path: "dev/web", lastIndex: 1, messages: 1, threads: 1 },
        ],
        head: 3,
      });
      await board.write(async (writer) => {
        expect(await writer.channel("dev")).toEqual({ path: "dev", lastIndex: 3, messages: 2, threads: 2 });
        expect(await writer.channel("de")).toBeNull();
      });
      const otherOrg = store.board(testScope({ ...keys, orgId: keys.orgId + 1 }));
      expect(await otherOrg.listChannels({ limit: 10 })).toEqual({ channels: [], head: 0 });
    } finally {
      await store.close();
    }
  });

  test(`${driver}: pages channels by path after a cursor, under a prefix, keeping the head`, async () => {
    const store = await open();
    try {
      const keys = await store.platform().findBoard("local", "main");
      if (!keys) throw new Error("the implicit board local/main is missing");
      const board = store.board(testScope(keys));
      const by = { actor: "ob:user:local-dev", principal: "ob:user:local-dev", profile: null };
      for (const channel of ["dev/web", "ops", "dev", "devops"]) {
        await board.write(async (writer) => {
          const { events } = messages.decidePost({ head: writer.head }, { channel, text: "hi" }, { by, now: 1 });
          await writer.append(events);
        });
      }
      const paths = async (query: Parameters<typeof board.listChannels>[0]) => {
        const { channels, head } = await board.listChannels(query);
        return { paths: channels.map((channel) => channel.path), head };
      };
      expect(await paths({ limit: 2 })).toEqual({ paths: ["dev", "dev/web"], head: 4 });
      expect(await paths({ after: "dev/web", limit: 2 })).toEqual({ paths: ["devops", "ops"], head: 4 });
      expect(await paths({ prefix: "dev/", limit: 10 })).toEqual({ paths: ["dev/web"], head: 4 });
      expect(await paths({ prefix: "dev", after: "dev", limit: 10 })).toEqual({
        paths: ["dev/web", "devops"],
        head: 4,
      });
      expect(await paths({ prefix: "zz", limit: 10 })).toEqual({ paths: [], head: 4 });
    } finally {
      await store.close();
    }
  });
}
