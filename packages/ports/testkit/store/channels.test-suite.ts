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
      expect(await board.listChannels()).toEqual({ channels: [], head: 0 });

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

      expect(await board.listChannels()).toEqual({
        channels: [
          { path: "dev", lastIndex: 3, messages: 2, threads: 2 },
          { path: "dev/web", lastIndex: 1, messages: 1, threads: 1 },
        ],
        head: 3,
      });
      const otherOrg = store.board(testScope({ ...keys, orgId: keys.orgId + 1 }));
      expect(await otherOrg.listChannels()).toEqual({ channels: [], head: 0 });
    } finally {
      await store.close();
    }
  });
}
