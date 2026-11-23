import { expect, test } from "bun:test";
import { connections } from "@openboard/core";
import type { BoardView } from "../../src/index.ts";
import { type OpenStore, testScope } from "../index.ts";

const by = { actor: "ob:user:local-test", principal: "ob:user:local-test", profile: null };
const secret = (letter: string) => ({ id: `cn_${letter.repeat(16)}`, hash: "cd".repeat(32), hint: "obc_…" });

/** Creates a connection named `name` the way the server does: decided under the lock from what the writer reads. */
function create(board: BoardView, name: string, letter: string) {
  return board.write(async (writer) => {
    const state = {
      head: writer.head,
      nextGrant: await writer.nextGrant(),
      nameTaken: await writer.connectionNamed(name),
    };
    const command = { name, can: { "*": "all" as const }, direct: true };
    const decided = connections.decideCreate(state, command, { by, now: 1_700_000_000_000, secret: secret(letter) });
    await writer.append(decided.events);
    return decided.connection;
  });
}

export function connectionsSuite(driver: string, open: OpenStore): void {
  test(`${driver}: stores a connection with its grant and secret hash, and the next grant ID moves on`, async () => {
    const store = await open();
    try {
      const keys = await store.platform().findBoard("local", "main");
      if (!keys) throw new Error("the implicit board local/main is missing");
      const board = store.board(testScope(keys));
      const laptop = await create(board, "laptop", "a");
      expect(laptop.grant).toBe("g4");
      expect(await board.connection(laptop.id)).toEqual({
        connection: laptop,
        grant: { id: 4, principals: [{ kind: "connection", connection: laptop.id }], can: laptop.can },
        secretHash: "cd".repeat(32),
      });
      const ci = await create(board, "ci", "b");
      expect(ci.grant).toBe("g5");
      await board.write(async (writer) => {
        expect(await writer.connectionNamed("laptop")).toBe(true);
        expect(await writer.connectionNamed("desktop")).toBe(false);
        expect(await writer.nextGrant()).toBe(6);
      });
      expect(await board.readEvents(0)).toEqual({ head: 2, cursor: 2, events: [] });
      expect(await board.connection("cn_cccccccccccccccc")).toBeNull();
      const otherOrg = store.board(testScope({ ...keys, orgId: keys.orgId + 1 }));
      expect(await otherOrg.connection(laptop.id)).toBeNull();
    } finally {
      await store.close();
    }
  });
}
