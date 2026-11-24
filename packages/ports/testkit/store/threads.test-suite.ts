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

async function checkReplyPages(board: BoardView): Promise<void> {
  const root = await post(board, "dev", "root");
  const rootId = Number(root.id);
  const first = await reply(board, rootId, "first reply");
  const second = await reply(board, rootId, "second reply");
  const third = await reply(board, rootId, "third reply");
  const last = await reply(board, rootId, "last reply");

  expect(await board.thread(Number(first.id), { after: rootId, limit: 1 })).toEqual({
    message: root,
    replies: [first],
  });
  expect(await board.thread(rootId, { after: Number(first.id), limit: 2 })).toEqual({
    message: root,
    replies: [second, third],
  });
  expect(await board.thread(rootId, { limit: 2 })).toEqual({ message: root, replies: [third, last] });
  expect(await board.thread(rootId, { after: Number(last.id) })).toEqual({ message: root, replies: [] });
}

/** Five threads, the first bumped to the newest by a reply, read two at a time from the newest page back. */
async function checkThreadPages(board: BoardView): Promise<void> {
  const roots = [];
  for (let index = 1; index <= 5; index++) roots.push(await post(board, "dev", String(index)));
  await reply(board, Number(roots[0]?.id), "bump");
  const first = await board.listThreads("dev", [], { limit: 2 });
  expect(first.threads.map(({ message }) => message.text)).toEqual(["5", "1"]);
  expect(first.older).toEqual({ active: Number(roots[4]?.id), root: Number(roots[4]?.id) });
  const second = await board.listThreads("dev", [], { before: first.older ?? undefined, limit: 2 });
  expect(second.threads.map(({ message }) => message.text)).toEqual(["3", "4"]);
  const last = await board.listThreads("dev", [], { before: second.older ?? undefined, limit: 2 });
  expect(last).toMatchObject({ threads: [{ message: roots[1] }], older: null });
}

/** Threads with and without a label, interleaved: pages hold only the labelled ones and end at the oldest of them. */
async function checkFilteredThreadPages(board: BoardView): Promise<void> {
  const kept = [];
  for (let index = 1; index <= 3; index++) {
    kept.push(await post(board, "dev", `kept ${index}`, { area: "api" }));
    await post(board, "dev", `skipped ${index}`);
  }
  const first = await board.listThreads("dev", [["area"]], { limit: 2 });
  expect(first.threads.map(({ message }) => message.text)).toEqual(["kept 2", "kept 3"]);
  const last = await board.listThreads("dev", [["area"]], { before: first.older ?? undefined, limit: 2 });
  expect(last).toMatchObject({ threads: [{ message: kept[0] }], older: null });
}

/** Four threads, the first bumped to the newest: `after` a position lists the first active past it, oldest first. */
async function checkThreadsAfter(board: BoardView): Promise<void> {
  const roots = [];
  for (let index = 1; index <= 4; index++) roots.push(await post(board, "dev", String(index)));
  const bump = await reply(board, Number(roots[0]?.id), "bump");
  const page = await board.listThreads("dev", [], { after: Number(roots[1]?.id), limit: 2 });
  expect(page).toMatchObject({ head: Number(bump.id), older: null });
  expect(page.threads.map(({ message }) => message.text)).toEqual(["3", "4"]);
  const rest = await board.listThreads("dev", [], { after: Number(roots[3]?.id) });
  expect(rest.threads.map(({ message }) => message.text)).toEqual(["1"]);
}

/** The thread list's pages: back by `older`, with and without a filter, and forward `after` a position. */
function pagingTests(localBoard: () => Promise<BoardView>): void {
  test("pages back from each page's oldest thread, listing every thread once", async () => {
    await checkThreadPages(await localBoard());
  });

  test("pages back through only the threads a label filter keeps", async () => {
    await checkFilteredThreadPages(await localBoard());
  });

  test("lists the first threads active after a position, oldest first, with no older", async () => {
    await checkThreadsAfter(await localBoard());
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

    test("selects replies in either direction while keeping the root and chronological order", async () => {
      await checkReplyPages(await localBoard());
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
        older: null,
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
        older: null,
      });
    });

    pagingTests(localBoard);

    test("reads no thread for a position no message holds", async () => {
      const board = await localBoard();
      await post(board, "dev", "hello");
      expect(await board.thread(0)).toBeNull();
      expect(await board.thread(2)).toBeNull();
    });
  });
}
