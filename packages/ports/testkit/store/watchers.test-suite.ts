import { afterEach, expect, test } from "bun:test";
import type { Watch } from "@openboard/contract";
import { messages } from "@openboard/core";
import type { BoardView, BoardWriter, Store } from "../../src/index.ts";
import { type OpenStore, testScope } from "../index.ts";

export function seedWatcher(
  board: BoardView,
  owner: string,
  channel: string,
  at: number,
  watch: Watch = { seed: { tail: channel } },
  text = channel,
) {
  return board.write(async (writer) => {
    await writer.append([
      {
        id: writer.head + 1,
        at,
        type: "ob.watchers.registered",
        visibility: 2,
        thread: null,
        message: null,
        channel: null,
        actor: owner,
        principal: owner,
        payload: { owner, watch, sync: [], url: null, hash: channel },
      },
    ]);
    const by = { actor: owner, principal: owner, profile: null };
    const author = { kind: "person" as const, handle: "registrant", name: "Registrant", avatar: null };
    const post = messages.decidePost({ head: writer.head, actor: null }, { channel, text }, { by, now: at, author });
    await writer.append(post.events);
  });
}

export function pull(
  board: BoardView,
  owner: string,
  now: number,
  canRead = (_channel: string) => true,
  canReadActorDirectory = true,
): ReturnType<BoardWriter["pullWatcherMatches"]> {
  return board.write((writer) =>
    writer.pullWatcherMatches({
      owner,
      now,
      canRead,
      canReadActorDirectory,
      mintLease: () => `lease-${now}`,
      limit: 10,
    }),
  );
}

export function watchersSuite(driver: string, open: OpenStore): void {
  let store: Store | undefined;
  afterEach(() => store?.close());

  const owner = "ob:user:reader";
  const at = 1_700_000_000_000;

  async function localBoard() {
    store = await open();
    const keys = await store.platform().findBoard("local", "main");
    if (!keys) throw new Error("missing local board");
    return store.board(testScope(keys));
  }

  test(`${driver}: a pull discards unreadable matches instead of leasing them`, async () => {
    const board = await localBoard();
    await seedWatcher(board, owner, "dev", at);
    expect(await pull(board, owner, at, (channel) => channel !== "dev")).toEqual([]);
    expect(await pull(board, owner, at)).toEqual([]);
  });

  test(`${driver}: an active lease still fences its thread after directory access changes`, async () => {
    const board = await localBoard();
    const watch = { alias: { tail: "dev --mentions @registrant" }, direct: { tail: "dev" } };
    await seedWatcher(board, owner, "dev", at, watch, `A note for @[${owner}]`);
    const [first] = await pull(board, owner, at);
    if (!first) throw new Error("missing first lease");
    expect(first.watcher).toBe("alias");
    expect(await pull(board, owner, at, undefined, false)).toEqual([]);
    await board.write((writer) => writer.ackWatcherMatch({ owner, id: first.id, lease: first.lease }));
    const [next] = await pull(board, owner, at, undefined, false);
    expect(next).toMatchObject({ watcher: "direct", event: { thread: first.event.thread } });
  });
}
