import { expect, test } from "bun:test";
import { messages } from "@openboard/core";
import { type OpenStore, testScope } from "../index.ts";

export function eventsSuite(driver: string, open: OpenStore): void {
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
            messages.decidePost({ head }, { channel: "dev", text: "hello" }, { by, now: 1_700_000_000_000 }).events[0],
        );
        await writer.append(events);
      });

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
