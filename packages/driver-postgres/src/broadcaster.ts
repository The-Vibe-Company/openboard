import type { BoardScope, Broadcaster } from "@openboard/ports";
import type { SQL } from "bun";

interface Subscription {
  position: number;
  readonly wake: () => void;
}

interface Board {
  readonly subscribers: Set<Subscription>;
  pending?: { position: number; readonly flush: ReturnType<typeof setImmediate> };
}

/** Bun's LISTEN uses a dedicated connection, outside the request pool. */
export async function postgresBroadcaster(sql: SQL): Promise<Broadcaster & { close(): Promise<void> }> {
  // Board IDs are globally unique. subscribe() receives a scope minted by the tenant resolver.
  const boards = new Map<number, Board>();

  function remove(id: number, board: Board, subscription: Subscription) {
    if (!board.subscribers.delete(subscription) || board.subscribers.size !== 0) return;
    if (board.pending) clearImmediate(board.pending.flush);
    boards.delete(id);
  }

  function publish({ boardId }: Pick<BoardScope, "boardId">, position: number) {
    const board = boards.get(boardId);
    if (!board) return;
    // A callback may unsubscribe or register a new waiter. Only wake existing subscriptions.
    for (const subscription of Array.from(board.subscribers)) {
      if (position <= subscription.position || !board.subscribers.has(subscription)) continue;
      subscription.position = position;
      try {
        subscription.wake();
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
    publish,
    subscribe({ boardId }, fromPosition, wake) {
      const board = boards.get(boardId) ?? { subscribers: new Set<Subscription>() };
      boards.set(boardId, board);
      const subscription = { position: fromPosition, wake };
      board.subscribers.add(subscription);
      return () => remove(boardId, board, subscription);
    },
    async close() {
      for (const { pending } of boards.values()) {
        if (pending) clearImmediate(pending.flush);
      }
      boards.clear();
      await listener.unlisten();
    },
  };
}
