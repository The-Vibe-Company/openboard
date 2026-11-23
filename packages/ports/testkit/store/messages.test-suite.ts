import { afterEach, describe, expect, test } from "bun:test";
import { decideDelete, decideEdit, decideReaction, messages } from "@openboard/core";
import type { BoardView, Store } from "../../src/index.ts";
import { type OpenStore, testScope } from "../index.ts";

const by = { actor: "ob:user:local-dev", principal: "ob:user:local-dev", profile: null };
const at = 1_700_000_000_000;

function post(board: BoardView, channel: string, text: string, labels?: Record<string, string>) {
  return board.write(async (writer) => {
    const command = { channel, text, ...(labels && { labels }) };
    const { events, message } = messages.decidePost({ head: writer.head }, command, { by, now: at });
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

/** Opens a store per test and closes it after: `board()` is its implicit local/main board. */
function eachStore(open: OpenStore) {
  let store: Store | undefined;
  afterEach(() => store?.close());
  return {
    async store(): Promise<Store> {
      store = await open();
      return store;
    },
    async board(): Promise<BoardView> {
      store = await open();
      const keys = await store.platform().findBoard("local", "main");
      if (!keys) throw new Error("the implicit board local/main is missing");
      return store.board(testScope(keys));
    },
  };
}

function repliesSuite(driver: string, open: OpenStore): void {
  describe(`${driver}: replies`, () => {
    const opened = eachStore(open);
    const localBoard = () => opened.board();

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
      expect(targets).toEqual([{ id: 1, channel: "dev", thread: 1 }, { id: 2, channel: "dev", thread: 1 }, null]);
    });

    test("finds the first reply of a thread after a position, under the lock", async () => {
      const board = await localBoard();
      await post(board, "dev", "hello");
      await post(board, "dev", "elsewhere");
      await reply(board, 1, "first");
      await reply(board, 2, "other thread");
      await reply(board, 1, "second");
      const newer = await board.write(async (writer) =>
        Promise.all([
          writer.newerReply(1, 1),
          writer.newerReply(1, 3),
          writer.newerReply(1, 5),
          writer.newerReply(2, 2),
          writer.newerReply(2, 4),
        ]),
      );
      expect(newer).toEqual([3, 5, null, 4, null]);
    });

    test("keeps a reply to a reply in its root's thread, with the reply it answered as replyTo", async () => {
      const board = await localBoard();
      const root = await post(board, "dev", "hello");
      const first = await reply(board, 1, "on it");
      const deeper = await reply(board, 2, "deeper");
      expect(deeper).toMatchObject({ id: "3", channel: "dev", re: "1", replyTo: "2", thread: "1" });
      expect(await board.thread(1)).toEqual({ message: root, replies: [first, deeper] });
      const { channels } = await board.listChannels({ limit: 10 });
      expect(channels).toEqual([{ path: "dev", lastIndex: 3, messages: 3, threads: 1 }]);
    });
  });
}

function clientIdsSuite(driver: string, open: OpenStore): void {
  describe(`${driver}: client IDs`, () => {
    const opened = eachStore(open);
    const localBoard = () => opened.board();

    test("finds a post by its client ID under the lock, and none for an ID nothing was posted with", async () => {
      const board = await localBoard();
      const landed = await board.write(async (writer) => {
        const command = { channel: "dev", text: "deploy", id: "deploy-1" };
        const { events, message } = messages.decidePost({ head: writer.head }, command, { by, now: at });
        await writer.append(events);
        return message;
      });
      await post(board, "dev", "no client ID");
      const found = await board.write(async (writer) =>
        Promise.all([writer.clientPost("deploy-1"), writer.clientPost("deploy-2")]),
      );
      expect(found).toEqual([landed, null]);
      expect(await board.ownClientPost("deploy-1", by)).toEqual(landed);
      expect(await board.ownClientPost("deploy-2", by)).toBeNull();
      expect(await board.ownClientPost("deploy-1", { ...by, actor: `${by.actor}+bot`, profile: "bot" })).toBeNull();
    });
  });
}

/** The writes that change a stored message: edits, deletes and reactions. */
function labelsSuite(open: OpenStore) {
  describe("posting a message with labels", () => {
    const opened = eachStore(open);

    test("keeps its labels, in the thread and in its channel", async () => {
      const board = await opened.board();
      const labels = { status: "open", "ci.run_2": "a=b" };
      const posted = await post(board, "dev", "hello", labels);
      expect(posted.labels).toEqual(labels);
      expect((await board.thread(1))?.message.labels).toEqual(labels);
      expect((await board.channelMessages({ channel: "dev", limit: 50 }))?.[0]?.labels).toEqual(labels);
    });
  });
}

function changeSuites(open: OpenStore): void {
  editMessageSuite(open);
  deleteMessageSuite(open);
  reactionSuite(open);
  labelsSuite(open);
}

export function messagesSuite(driver: string, open: OpenStore): void {
  changeSuites(open);
  repliesSuite(driver, open);
  clientIdsSuite(driver, open);
  describe(`${driver}: messages`, () => {
    const opened = eachStore(open);
    const localBoard = () => opened.board();

    test("finds the implicit board local/main and no other", async () => {
      const store = await opened.store();
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
      expect(page?.map(({ text }) => text)).toEqual(["b", "c"]);
      expect((await board.channelMessages({ channel: "dev", limit: 1 }))?.map(({ text }) => text)).toEqual(["c"]);
      expect((await board.channelMessages({ channel: "dev", limit: 50 }))?.map(({ text }) => text)).toEqual([
        "a",
        "b",
        "c",
      ]);
      expect(await board.channelMessages({ channel: "empty", limit: 50 })).toEqual([]);
    });

    test("reads one channel's first messages after a position, oldest first, and on from the last", async () => {
      const board = await localBoard();
      for (const text of ["a", "b", "c"]) await post(board, "dev", text);
      await post(board, "ops", "elsewhere");
      await post(board, "dev", "d");
      const page = await board.channelMessages({ channel: "dev", after: 1, limit: 2 });
      expect(page?.map(({ id, text }) => [id, text])).toEqual([
        ["2", "b"],
        ["3", "c"],
      ]);
      const rest = await board.channelMessages({ channel: "dev", after: 3, limit: 2 });
      expect(rest?.map(({ id, text }) => [id, text])).toEqual([["5", "d"]]);
      expect(await board.channelMessages({ channel: "dev", after: 5, limit: 2 })).toEqual([]);
      expect(await board.channelMessages({ channel: "dev", after: 6, limit: 2 })).toBeNull();
      expect(await board.channelMessages({ channel: "quiet", after: 5, limit: 2 })).toEqual([]);
      expect((await board.channelMessages({ channel: "dev", after: 0, limit: 1 }))?.map(({ id }) => id)).toEqual(["1"]);
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

function editMessageSuite(open: OpenStore) {
  describe("editing a stored message", () => {
    const fixture = eachStore(open);
    test("serializes edits and persists each revision in its event", async () => {
      const board = await fixture.board();
      const original = await post(board, "dev", "old text");
      const edit = (text: string) =>
        board.write(async (writer) => {
          const target = await writer.message(1);
          const event = decideEdit({ head: writer.head, target }, { id: original.id, text }, { by, now: at + 1 });
          await writer.append([event]);
        });
      await Promise.all([edit("first edit"), edit("second edit")]);
      const { events } = await board.readEvents(1);
      const edits = events.filter((event) => event.type === "message.edited");
      expect(edits.map(({ payload: { view } }) => [view.revision, view.version])).toEqual([
        [1, 2],
        [2, 3],
      ]);
      const stored = await board.channelMessages({ channel: "dev", limit: 50 });
      expect(stored?.[0]).toEqual(edits[1]?.payload.view);
      expect(stored?.[0]).toMatchObject({ id: original.id, createdAt: original.createdAt, revision: 2 });
    });
  });
}

function deleteMessageSuite(open: OpenStore) {
  describe("deleting stored replies", () => {
    const fixture = eachStore(open);
    test("counts live replies and keeps tombstones in the thread", async () => {
      const board = await fixture.board();
      const root = await post(board, "dev", "root");
      const first = await reply(board, 1, "first");
      await reply(board, 1, "latest");
      for (const id of [3, 2]) {
        await board.write(async (writer) => {
          const target = await writer.message(id);
          const event = decideDelete({ head: writer.head, target }, { id: String(id) }, { by, now: at });
          if (!event) throw new Error("expected a deletion");
          await writer.append([event]);
        });
        const { threads } = await board.listThreads("dev");
        expect(threads).toEqual([{ message: root, replies: id - 2, last: id === 3 ? first : null }]);
      }
      expect(await board.thread(1)).toMatchObject({
        message: root,
        replies: [
          { id: "2", deleted: true, text: "" },
          { id: "3", deleted: true, text: "" },
        ],
      });
    });
  });
}

function reactionSuite(open: OpenStore) {
  describe("reacting to a stored message", () => {
    const fixture = eachStore(open);
    test("serializes reactions racing on one message and keeps every actor in the stored view", async () => {
      const board = await fixture.board();
      await post(board, "dev", "hello");
      const react = (actor: string) =>
        board.write(async (writer) => {
          const target = await writer.message(1);
          const writerBy = { actor, principal: actor, profile: null };
          const events = decideReaction(
            { head: writer.head, target },
            { id: "1", emoji: "eyes" },
            { by: writerBy, now: at },
          );
          await writer.append(events);
        });
      await Promise.all([react("ob:user:a"), react("ob:user:b")]);
      const [stored] = (await board.channelMessages({ channel: "dev", limit: 50 })) ?? [];
      expect(stored?.reactions.eyes?.toSorted()).toEqual(["ob:user:a", "ob:user:b"]);
      expect(stored).toMatchObject({ version: 3, revision: 0 });
      expect((await board.thread(1))?.message).toEqual(stored);
    });
  });
}
