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

function reply(board: BoardView, re: number, text: string) {
  return board.write(async (writer) => {
    const target = await writer.replyTarget(re);
    const command = { re: String(re), text };
    const { events, message } = messages.decidePost({ head: writer.head, target }, command, { by, now: at });
    await writer.append(events);
    return message;
  });
}

export function messagesSuite(driver: string, open: OpenStore): void {
  describe(`${driver}: messages`, () => {
    let store: Store | undefined;
    afterEach(() => store?.close());

    async function localBoard(): Promise<BoardView> {
      store = await open();
      const keys = await store.platform().findBoard("local", "main");
      if (!keys) throw new Error("the implicit board local/main is missing");
      return store.board(testScope(keys));
    }

    test("finds the implicit board local/main and no other", async () => {
      store = await open();
      expect(await store.platform().findBoard("local", "main")).not.toBeNull();
      expect(await store.platform().findBoard("local", "other")).toBeNull();
      expect(await store.platform().findBoard("acme", "main")).toBeNull();
    });

    test("reads back a posted message at the next log position", async () => {
      const board = await localBoard();
      const first = await post(board, "dev", "hello");
      const second = await post(board, "dev", "again");
      expect([first.id, second.id]).toEqual(["1", "2"]);
      expect(await board.channelMessages({ channel: "dev", limit: 50 })).toEqual([first, second]);
    });

    test("reads one channel's latest messages, oldest first", async () => {
      const board = await localBoard();
      for (const text of ["a", "b", "c"]) await post(board, "dev", text);
      await post(board, "ops", "elsewhere");
      const page = await board.channelMessages({ channel: "dev", limit: 2 });
      expect(page.map(({ text }) => text)).toEqual(["b", "c"]);
      expect(await board.channelMessages({ channel: "empty", limit: 50 })).toEqual([]);
    });

    test("keeps a reply in its root's thread and channel, and counts it in the channel", async () => {
      const board = await localBoard();
      const root = await post(board, "dev", "hello");
      const answer = await reply(board, 1, "on it");
      expect(answer).toMatchObject({ id: "2", channel: "dev", re: "1", thread: "1" });
      expect(await board.thread(1)).toEqual({ message: root, replies: [answer] });
      expect(await board.channelMessages({ channel: "dev", limit: 50 })).toEqual([root, answer]);
      const { channels } = await board.listChannels({ limit: 10 });
      expect(channels).toEqual([{ path: "dev", lastIndex: 2, messages: 2, threads: 1 }]);
    });

    test("finds the message a reply names under the lock, and none for an unknown ID", async () => {
      const board = await localBoard();
      await post(board, "dev", "hello");
      await reply(board, 1, "on it");
      const targets = await board.write(async (writer) =>
        Promise.all([writer.replyTarget(1), writer.replyTarget(2), writer.replyTarget(3)]),
      );
      expect(targets).toEqual([{ id: 1, channel: "dev", re: null }, { id: 2, channel: "dev", re: "1" }, null]);
    });

    test("serializes concurrent writes into consecutive positions", async () => {
      const board = await localBoard();
      const posted = await Promise.all(["a", "b", "c"].map((text) => post(board, "dev", text)));
      expect(posted.map(({ id }) => id).sort()).toEqual(["1", "2", "3"]);
    });

    test("keeps nothing of a write that throws", async () => {
      const board = await localBoard();
      const failing = board.write(async (writer) => {
        const { events } = messages.decidePost(
          { head: writer.head },
          { channel: "dev", text: "lost" },
          { by, now: at },
        );
        await writer.append(events);
        throw new Error("decided against it");
      });
      await expect(failing).rejects.toThrow("decided against it");
      expect(await board.channelMessages({ channel: "dev", limit: 50 })).toEqual([]);
      expect((await post(board, "dev", "kept")).id).toBe("1");
    });
  });
}
