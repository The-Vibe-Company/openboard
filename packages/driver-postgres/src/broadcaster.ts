import type { Db } from "@openboard/driver-sql";
import type { BoardScope, Broadcaster, CommittedPage } from "@openboard/ports";
import type { SQL } from "bun";

interface Subscription {
  position: number;
  readonly wake: (page?: CommittedPage) => void;
}

interface Board {
  readonly subscribers: Set<Subscription>;
  pending?: { position: number; readonly flush: ReturnType<typeof setImmediate> };
}

type Repeat = (tick: () => Promise<void>, milliseconds: number) => () => void;

function repeat(tick: () => Promise<void>, milliseconds: number) {
  const timer = setInterval(tick, milliseconds);
  return () => clearInterval(timer);
}

function pollBoardHeads(
  db: Db,
  boards: ReadonlyMap<number, Board>,
  publish: (scope: Pick<BoardScope, "boardId">, position: number) => void,
) {
  let polling = false;
  return async () => {
    if (polling || boards.size === 0) return;
    polling = true;
    const subscribed = new Map(boards);
    try {
      // Platform query: board IDs are globally unique and come only from active scoped subscriptions.
      const ids = `{${Array.from(subscribed.keys()).join(",")}}`;
      // A failed background read leaves positions intact, so the next tick can retry.
      const heads = await db.query("SELECT id, head FROM boards WHERE id = ANY($1::bigint[])", [ids]).catch(() => []);

      for (const row of heads) {
        const boardId = Number(row.id);
        if (boards.get(boardId) === subscribed.get(boardId)) {
          publish({ boardId }, Number(row.head));
        }
      }
    } finally {
      polling = false;
    }
  };
}

/**
 * Bun's LISTEN uses a dedicated connection, outside the request pool.
 * Board IDs are globally unique and subscribe() receives a scope minted by the tenant resolver.
 * A local commit's wake carries its page; a notification or a polled head does not, so its subscribers read the store.
 */
export async function postgresBroadcaster(
  sql: SQL,
  db: Db,
  schedule: Repeat = repeat,
): Promise<Broadcaster & { close(): Promise<void> }> {
  const boards = new Map<number, Board>();
  let stopPoll: (() => void) | undefined;
  let closed = false;

  function stopPolling() {
    stopPoll?.();
    stopPoll = undefined;
  }

  const poll = pollBoardHeads(db, boards, publish);

  function remove(id: number, board: Board, subscription: Subscription) {
    if (!board.subscribers.delete(subscription) || board.subscribers.size !== 0) return;
    if (board.pending) clearImmediate(board.pending.flush);
    boards.delete(id);
    if (boards.size === 0) stopPolling();
  }

  function publish({ boardId }: Pick<BoardScope, "boardId">, position: number, page?: CommittedPage) {
    const board = boards.get(boardId);
    if (!board) return;
    // A callback may unsubscribe or register a new waiter. Only wake existing subscriptions.
    for (const subscription of Array.from(board.subscribers)) {
      if (position <= subscription.position || !board.subscribers.has(subscription)) continue;
      subscription.position = position;
      try {
        subscription.wake(page);
      } catch {
        remove(boardId, board, subscription);
      }
    }
  }

  const listener = await sql.listen("ob_events", (payload) => {
    const match = /^(\d+):(\d+)$/.exec(payload);
    if (!match) return;
    const boardId = Number(match[1]);
    const position = Number(match[2]);
    if (!Number.isSafeInteger(boardId) || !Number.isSafeInteger(position)) return;
    const board = boards.get(boardId);
    if (!board) return;
    if (board.pending) {
      board.pending.position = Math.max(board.pending.position, position);
      return;
    }
    const flush = setImmediate(() => {
      const pending = board.pending;
      delete board.pending;
      if (pending) publish({ boardId }, pending.position);
    });
    board.pending = { position, flush };
  });

  return {
    publish: (scope, page) => publish(scope, page.head, page),
    subscribe({ boardId }, fromPosition, wake) {
      if (closed) return () => {};
      const board = boards.get(boardId) ?? { subscribers: new Set<Subscription>() };
      boards.set(boardId, board);
      const subscription = { position: fromPosition, wake };
      board.subscribers.add(subscription);
      stopPoll ??= schedule(poll, 2_000);
      return () => remove(boardId, board, subscription);
    },
    async close() {
      closed = true;
      stopPolling();
      for (const { pending } of boards.values()) {
        if (pending) clearImmediate(pending.flush);
      }
      boards.clear();
      await listener.unlisten();
    },
  };
}
