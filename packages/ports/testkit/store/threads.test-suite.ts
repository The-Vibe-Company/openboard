import { afterEach, describe, expect, test } from "bun:test";
import { messages } from "@openboard/core";
import type { BoardView, Store } from "../../src/index.ts";
import { type OpenStore, testScope } from "../index.ts";

const by = { actor: "ob:user:local-dev", principal: "ob:user:local-dev", profile: null };
const at = 1_700_000_000_000;

function post(board: BoardView, channel: string, text: string) {
  return board.write(async (writer) => {
    const { events, message } = messages.decidePost({ head: writer.head }, { channel, text }, { by, now: at });
    await writer.append(events);
    return message;
  });
}

export function threadsSuite(driver: string, open: OpenStore): void {
  describe(`${driver}: threads`, () => {
    let store: Store | undefined;
    afterEach(() => store?.close());

    async function localBoard(): Promise<BoardView> {
      store = await open();
      const keys = await store.platform().findBoard("local", "main");
      if (!keys) throw new Error("the implicit board local/main is missing");
      return store.board(testScope(keys));
    }

    test("reads a posted message as a thread with no replies", async () => {
      const board = await localBoard();
      const first = await post(board, "dev", "hello");
      const second = await post(board, "dev", "again");
      expect(await board.thread(1)).toEqual({ message: first, replies: [] });
      expect(await board.thread(2)).toEqual({ message: second, replies: [] });
    });

    test("reads no thread for a position no message holds", async () => {
      const board = await localBoard();
      await post(board, "dev", "hello");
      expect(await board.thread(0)).toBeNull();
      expect(await board.thread(2)).toBeNull();
    });
  });
}
