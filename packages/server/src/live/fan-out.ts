import { formatId, matchesEventChannel, matchesTailEvent } from "@openboard/core";
import type { BoardView, CommittedEvents } from "@openboard/ports";

type ReadEvents = BoardView["readEvents"];
type EventPage = Awaited<ReturnType<ReadEvents>>;
type Filters = NonNullable<Parameters<ReadEvents>[1]>;

function joinInFlight<T>(pending: Map<string, Promise<T>>, key: string, start: () => Promise<T>): Promise<T> {
  const existing = pending.get(key);
  if (existing) return existing;
  const work = start().finally(() => pending.delete(key));
  pending.set(key, work);
  return work;
}

/** Forward reads scan the same positions regardless of filters. Share the read, then filter for each tail. */
export function sharedForwardReads(
  board: BoardView,
  scope: string,
  pending: Map<string, Promise<EventPage>>,
): BoardView {
  let opened = false;
  const readEvents: ReadEvents = async (after, filters = {}) => {
    // Opening a tail takes its own snapshot. Share forward reads during follow and catch-up.
    if (!opened) {
      opened = true;
      return board.readEvents(after, filters);
    }
    if (after === undefined || filters.last !== undefined) return board.readEvents(after, filters);
    const all = filters.all === true;
    if (filters.labels?.length || filters.text !== undefined || filters.mentions !== undefined) {
      // These filters require previous versions or root labels from storage.
      const key = JSON.stringify([scope, after, all, filters]);
      return joinInFlight(pending, key, () => board.readEvents(after, filters));
    }
    const key = JSON.stringify([scope, after, all]);
    const page = await joinInFlight(pending, key, () => board.readEvents(after, { all }));
    if (
      filters.channel === undefined &&
      filters.thread === undefined &&
      filters.from === undefined &&
      filters.authors === undefined
    )
      return page;
    return { ...page, events: page.events.filter((event) => matchesForwardEvent(event, filters)) };
  };
  return new Proxy(board, {
    get: (target, key) => (key === "readEvents" ? readEvents : Reflect.get(target, key)),
  });
}

function matchesForwardEvent(event: EventPage["events"][number], filters: Filters): boolean {
  if (event.visibility === 1) return false;
  if (event.type === "watch.failed") {
    return (
      filters.from === undefined &&
      filters.authors === undefined &&
      matchesEventChannel(event.channel, filters.channel) &&
      (filters.thread === undefined || formatId(event.thread) === filters.thread)
    );
  }
  return matchesTailEvent(event, filters);
}

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
 * broadcaster could not carry) sends the tail to the store if the announced head is ahead of its cursor.
 */
export function tailBoard(board: BoardView, after: number | undefined): Tail {
  let queued: CommittedEvents | undefined;
  let behind = true;
  let announced = 0;
  let waiter: (() => void) | undefined;
  const notify = () => {
    const resolve = waiter;
    waiter = undefined;
    resolve?.();
  };
  const unsubscribe = board.subscribeEvents(
    after ?? 0,
    (committed, head) => {
      announced = Math.max(announced, head);
      if (committed !== undefined && queued !== undefined) {
        queued = undefined;
        behind = true;
      } else if (committed !== undefined && !behind) {
        queued = committed;
      }
      notify();
    },
    () => {
      queued = undefined;
      behind = true;
      notify();
    },
  );
  return {
    take(cursor) {
      const page = queued;
      queued = undefined;
      // Keep the announced head until covered: a shared read may have taken an older snapshot.
      if (cursor !== undefined && announced <= cursor) announced = 0;
      if (!behind && page !== undefined && cursor !== undefined && page.head > cursor) {
        if (page.after === cursor && page.head >= announced) return { committed: page };
        behind = true;
      }
      if (cursor !== undefined && announced > cursor) behind = true;
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
