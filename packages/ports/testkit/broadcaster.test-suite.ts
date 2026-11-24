import { expect, test } from "bun:test";
import { messages } from "@openboard/core";
import { type OpenStore, testScope } from "./index.ts";
import { at, storeTenant } from "./isolation-seed.ts";

export function runBroadcasterSuite(driver: string, open: OpenStore): void {
  test(`${driver}: only committed positions above the cursor wake a subscription`, async () => {
    const store = await open();
    try {
      const keys = await store.platform().findBoard("local", "main");
      if (!keys) throw new Error("missing local board");
      const board = store.board(testScope(keys));
      const by = { actor: "ob:user:local-test", principal: "ob:user:local-test", profile: null };
      let wakes = 0;
      const append = (rollback = false) => {
        const before = wakes;
        return board.write(async (writer) => {
          const posted = messages.decidePost({ head: writer.head }, { channel: "dev", text: "hi" }, { by, now: 0 });
          await writer.append(posted.events);
          expect(wakes).toBe(before);
          if (rollback) throw new Error("rollback");
        });
      };
      const unsubscribe = board.subscribeEvents(1, () => {
        wakes++;
      });
      const unsubscribeBroken = board.subscribeEvents(1, () => {
        throw new Error("broken subscriber");
      });
      const observed: number[] = [];
      const unsubscribeOther = board.subscribeEvents(1, () => {
        observed.push(1);
      });
      try {
        await append();
        expect(wakes).toBe(0);
        await expect(append(true)).rejects.toThrow("rollback");
        expect(wakes).toBe(0);
        await board.write(async () => undefined);
        expect(wakes).toBe(0);
        await append();
        expect(wakes).toBe(1);
        expect(observed).toEqual([1]);
      } finally {
        unsubscribeOther();
        unsubscribeBroken();
        unsubscribe();
      }
      await append();
      expect(wakes).toBe(1);
    } finally {
      await store.close();
    }
  }, 500);

  test(`${driver}: a commit on another board does not wake this board's subscribers`, async () => {
    const store = await open();
    try {
      const keys = await store.platform().findBoard("local", "main");
      if (!keys) throw new Error("missing local board");
      const a = store.board(testScope(keys));
      const b = await storeTenant(store, "bravo", "b", 0);
      let wakes = 0;
      const unsubscribe = a.subscribeEvents(0, () => {
        wakes++;
      });
      try {
        await b.board.write(async (writer) => {
          const by = { actor: b.actor, principal: b.actor, profile: null };
          const posted = messages.decidePost(
            { head: writer.head },
            { channel: b.channel, text: "hi" },
            { by, now: at },
          );
          await writer.append(posted.events);
        });
        expect(wakes).toBe(0);
      } finally {
        unsubscribe();
      }
    } finally {
      await store.close();
    }
  }, 500);
}
