import type { Db } from "@openboard/driver-sql";
import type { BoardScope, Broadcaster, CommittedPage } from "@openboard/ports";
import type { SQL } from "bun";

interface Subscription {
  position: number;
  readonly wake: (page: CommittedPage | undefined, head: number) => void;
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

/** Whether this instance is committing `position` on the board: its publish then follows, carrying the page. */
type Own = (boardId: number, position: number) => boolean;

function pollBoardHeads(
  db: Db,
  boards: ReadonlyMap<number, Board>,
  publish: (scope: Pick<BoardScope, "boardId">, position: number) => void,
) {
  return async () => {
    if (boards.size === 0) return;
    const subscribed = new Map(boards);
    // Platform query: board IDs are globally unique and come only from active scoped subscriptions.
    const ids = `{${Array.from(subscribed.keys()).join(",")}}`;
    // A failed background read leaves positions intact, so the next tick can retry.
    const heads = await db.query("SELECT id, head FROM boards WHERE id = ANY($1::bigint[])", [ids]).catch(() => []);

    for (const row of heads) {
      const boardId = Number(row.id);
      // Not filtered by `own`: the poll is the backstop even while a write's outcome is still unknown (D36).
      if (boards.get(boardId) === subscribed.get(boardId)) {
        publish({ boardId }, Number(row.head));
      }
    }
  };
}

function reconnectPoll(readHeads: () => Promise<void>) {
  let polling = false;
  let catchUpPending = false;

  async function poll() {
    if (polling) return;
    polling = true;
    try {
      do {
        catchUpPending = false;
        await readHeads();
      } while (catchUpPending);
    } finally {
      polling = false;
    }
  }

  let listening = false;
  function onListen() {
    // Bun calls this after the initial LISTEN and after each successful re-subscription.
    if (listening) {
      // A poll already in flight could have read a snapshot from before LISTEN was restored.
      catchUpPending = true;
      void poll();
    }
    listening = true;
  }

  return { poll, onListen };
}

function onNotification(
  boards: ReadonlyMap<number, Board>,
  publish: (scope: Pick<BoardScope, "boardId">, position: number) => void,
  own: Own,
) {
  return (payload: string) => {
    const match = /^(\d+):(\d+)$/.exec(payload);
    if (!match) return;
    const boardId = Number(match[1]);
    const position = Number(match[2]);
    if (!Number.isSafeInteger(boardId) || !Number.isSafeInteger(position)) return;
    const board = boards.get(boardId);
    // This instance's own commit: its publish follows with the page, which the notification would make tails re-read.
    if (!board || own(boardId, position)) return;
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
  // The heads each of this instance's writes is committing, by board: after `after`, up to `head`.
  const committing = new Map<number, Set<{ readonly after: number; readonly head: number }>>();
  const own: Own = (boardId, position) => {
    for (const range of committing.get(boardId) ?? [])
      if (range.after < position && position <= range.head) return true;
    return false;
  };
  let stopPoll: (() => void) | undefined;
  let closed = false;

  function stopPolling() {
    stopPoll?.();
    stopPoll = undefined;
  }

  const { poll, onListen } = reconnectPoll(pollBoardHeads(db, boards, publish));

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
        subscription.wake(page, position);
      } catch {
        remove(boardId, board, subscription);
      }
    }
  }

  const listener = await sql.listen("ob_events", onNotification(boards, publish, own), onListen);

  return {
    publish: (scope, page) => publish(scope, page.head, page),
    committing({ boardId }, after, head) {
      const ranges = committing.get(boardId) ?? new Set();
      committing.set(boardId, ranges);
      const range = { after, head };
      ranges.add(range);
      return () => {
        if (ranges.delete(range) && ranges.size === 0 && committing.get(boardId) === ranges) committing.delete(boardId);
      };
    },
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
