import { expect, test } from "bun:test";
import { connections, messages } from "@openboard/core";
import { type OpenStore, testScope } from "../index.ts";

const by = { actor: "ob:user:local-test", principal: "ob:user:local-test", profile: null };
const secret = { id: `cn_${"a".repeat(16)}`, hash: "cd".repeat(32), hint: "…aaaa" };

export function auditSuite(driver: string, open: OpenStore): void {
  test(`${driver}: reads the board's configuration events in log order, a page at a time, without its messages`, async () => {
    const store = await open();
    try {
      const keys = await store.platform().findBoard("local", "main");
      if (!keys) throw new Error("the implicit board local/main is missing");
      const board = store.board(testScope(keys));
      expect(await board.auditEvents(0, 10)).toEqual({ head: 0, events: [] });
      const created = await board.write(async (writer) => {
        const state = { head: writer.head, nextGrant: await writer.nextGrant(), nameTaken: false };
        const decided = connections.decideCreate(
          state,
          { name: "laptop", can: { "*": "all" } },
          { by, now: 1, secret },
        );
        await writer.append(decided.events);
        return decided.events[0];
      });
      await board.write(async (writer) => {
        const { events } = messages.decidePost({ head: writer.head }, { channel: "dev", text: "hi" }, { by, now: 2 });
        await writer.append(events);
      });
      const revoked = connections.decideRevoke(2, { connection: secret.id, grant: 4 }, { by, now: 3 });
      await board.write((writer) => writer.append([revoked]));

      expect(await board.auditEvents(0, 10)).toEqual({ head: 3, events: [created, revoked] });
      expect(await board.auditEvents(0, 1)).toEqual({ head: 3, events: [created] });
      expect(await board.auditEvents(1, 10)).toEqual({ head: 3, events: [revoked] });
      expect(await board.auditEvents(3, 10)).toEqual({ head: 3, events: [] });
      const otherOrg = store.board(testScope({ ...keys, orgId: keys.orgId + 1 }));
      await expect(otherOrg.auditEvents(0, 10)).rejects.toThrow();
    } finally {
      await store.close();
    }
  });
}
