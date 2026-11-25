import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { messages } from "@openboard/core";
import type { BoardKeys, Store } from "../../src/index.ts";
import { testScope } from "../index.ts";

export type ReprojectStore = Store & {
  seedReprojectLog(keys: BoardKeys, count: number): Promise<void>;
};

export function reprojectSuite(driver: string, open: () => Promise<ReprojectStore>): void {
  describe(`${driver}: reprojection`, () => {
    let store: ReprojectStore;
    let keys: BoardKeys;
    const count = 256_000;
    beforeAll(async () => {
      store = await open();
      const local = await store.platform().findBoard("local", "main");
      if (!local) throw new Error("Missing local board");
      keys = local;
      await store.seedReprojectLog(keys, count);
    });
    afterAll(() => store?.close());

    test("reprojects several hundred thousand events across page boundaries", async () => {
      const platform = store.platform();
      const board = store.board(testScope(keys));
      const posted = await board.write(async (writer) => {
        const { events, message } = messages.decidePost(
          { head: writer.head },
          { channel: "dev", text: "Past the final page boundary" },
          { by: { actor: "local", principal: "local", profile: null }, now: 0 },
        );
        await writer.append(events);
        return message;
      });
      expect(await platform.reprojectBoard(keys)).toEqual({ events: count + 1, projection: 1 });
      expect(await board.thread(count + 1)).toMatchObject({ message: posted });
      const { channels } = await board.listChannels({ prefix: "history", limit: 100 });
      expect(channels.map(({ path }) => path).sort()).toEqual(
        Array.from({ length: Math.ceil(count / 4096) }, (_, i) => `history/${i * 4096 + 1}`).sort(),
      );
      expect(await platform.reprojectBoard(keys, true)).toBeNull();
    });
  });
}
