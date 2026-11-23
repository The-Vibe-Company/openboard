import { afterEach, describe, expect, test } from "bun:test";
import { messages } from "@openboard/core";
import type { BoardView, Store } from "../../src/index.ts";
import { type OpenStore, testScope } from "../index.ts";

const by = { actor: "ob:user:local-dev", principal: "ob:user:local-dev", profile: null };
const at = 1_700_000_000_000;

function post(board: BoardView, channel: string, text: string, labels?: Record<string, string>) {
  return board.write(async (writer) => {
    const { events, message } = messages.decidePost(
      { head: writer.head },
      { channel, text, ...(labels && { labels }) },
      { by, now: at },
    );
    await writer.append(events);
    return message;
  });
}

function reply(board: BoardView, id: number, text: string) {
  return board.write(async (writer) => {
    const target = await writer.replyTarget(id);
    const { events, message } = messages.decidePost(
      { head: writer.head, target },
      { re: String(id), text },
      { by, now: at },
    );
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

    test("lists the channel's roots by activity with the total and latest nested reply", async () => {
      const board = await localBoard();
      const root = await post(board, "dev", "first thread");
      const firstReply = await reply(board, Number(root.id), "first reply");
      const quiet = await post(board, "dev", "second thread");
      const last = await reply(board, Number(firstReply.id), "latest reply");
      const other = await post(board, "dev/ops", "another channel");

      expect(await board.listThreads("dev")).toEqual({
        threads: [
          { message: quiet, replies: 0, last: null },
          { message: root, replies: 2, last },
        ],
        head: Number(other.id),
      });
    });

    test("lists the latest 50 roots while preserving ascending activity order", async () => {
      const board = await localBoard();
      for (let index = 1; index <= 51; index++) await post(board, "dev", String(index));
      const { threads } = await board.listThreads("dev");
      expect(threads.map(({ message }) => message.text)).toEqual(
        Array.from({ length: 50 }, (_, index) => String(index + 2)),
      );
    });

    test("filters the channel before limiting the page", async () => {
      const board = await localBoard();
      const match = await post(board, "dev", "old match", { status: "open" });
      for (let index = 0; index < 50; index++) await post(board, "dev", String(index), { status: "closed" });
      const foreign = await post(board, "ops", "different channel", { status: "open" });
      expect(await board.listThreads("dev", [["status", ["open"]]])).toEqual({
        threads: [{ message: match, replies: 0, last: null }],
        head: Number(foreign.id),
      });
    });

    test("reads no thread for a position no message holds", async () => {
      const board = await localBoard();
      await post(board, "dev", "hello");
      expect(await board.thread(0)).toBeNull();
      expect(await board.thread(2)).toBeNull();
    });
  });
}
