import type { BoardView, CommittedEvents } from "@openboard/ports";

/** What a tail serves next after its cursor: a committed page from memory, a store read, or nothing yet. */
export type Next = { readonly committed: CommittedEvents } | "store" | "wait";

/** One live reader's subscription: at most one committed page queued, and a store read whenever it falls behind. */
export interface Tail {
  /** Take what to serve after `cursor`. A store read clears the backlog: wakes during it queue again. */
  take(cursor: number | undefined): Next;
  /** After serving a page: read the store again when the page left rows behind it or asked for a retry. */
  settle(page: { readonly cursor: number; readonly head: number; readonly retry?: boolean }): void;
  /** Resolve on the next wake or `interrupt`. */
  wait(): Promise<void>;
  interrupt(): void;
  close(): void;
}

/**
 * Subscribe before the first read, so no commit is lost between them. A commit's page is delivered once, in memory,
 * to every tail of the board; a tail that has not consumed its queued page when the next one arrives drops both and
 * catches up from the store, so a slow reader never holds pages for the others. A wake without a page (one the
 * broadcaster could not carry) also sends the tail to the store.
 */
export function tailBoard(board: BoardView, after: number | undefined): Tail {
  let queued: CommittedEvents | undefined;
  let behind = true;
  let waiter: (() => void) | undefined;
  const notify = () => {
    const resolve = waiter;
    waiter = undefined;
    resolve?.();
  };
  const unsubscribe = board.subscribeEvents(after ?? 0, (committed) => {
    if (committed === undefined || queued !== undefined) {
      queued = undefined;
      behind = true;
    } else if (!behind) {
      queued = committed;
    }
    notify();
  });
  return {
    take(cursor) {
      const page = queued;
      queued = undefined;
      if (!behind && page !== undefined && cursor !== undefined && page.head > cursor) {
        if (page.after === cursor) return { committed: page };
        behind = true;
      }
      if (!behind) return "wait";
      behind = false;
      return "store";
    },
    settle(page) {
      if (page.retry || page.cursor < page.head) behind = true;
    },
    wait: () =>
      new Promise<void>((resolve) => {
        waiter = resolve;
      }),
    interrupt: notify,
    close() {
      unsubscribe();
      queued = undefined;
      notify();
    },
  };
}
