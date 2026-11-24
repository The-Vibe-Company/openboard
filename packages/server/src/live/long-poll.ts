import type { CommittedEvents } from "@openboard/ports";
import type { Deps } from "../deps.ts";
import type { Tail } from "./fan-out.ts";

const MAX_WAIT_SECONDS = 120;

type Page = {
  readonly cursor: number;
  readonly head: number;
  readonly events: readonly unknown[];
  readonly retry?: boolean;
};

/**
 * Serve the tail's next page, waiting for one with events, carrying the last scanned cursor across filtered pages.
 * A page comes from the commit in memory when the tail holds it, else from storage. Resolves undefined only when
 * stopped before any read, which a tail's first call never is: a new tail starts with a store read.
 */
export async function longPoll<P extends Page>(
  tail: Tail,
  after: number | undefined,
  seconds: number | "stream",
  signal: AbortSignal,
  schedule: Deps["schedule"],
  read: (after: number | undefined, committed?: CommittedEvents) => Promise<P>,
): Promise<P | undefined> {
  if (signal.aborted) return read(after);

  let stopped = false;
  const stop = () => {
    stopped = true;
    tail.interrupt();
  };
  signal.addEventListener("abort", stop, { once: true });
  let cancel: (() => void) | undefined;
  let cursor = after;
  let last: P | undefined;
  try {
    if (seconds !== "stream") cancel = schedule(Math.min(seconds, MAX_WAIT_SECONDS) * 1000, stop);
    while (true) {
      const next = tail.take(cursor);
      if (next === "wait") {
        if (stopped) return last;
        await tail.wait();
        if (stopped) return last;
        continue;
      }
      const page = await read(cursor, next === "store" ? undefined : next.committed);
      tail.settle(page);
      last = page;
      if (page.events.length > 0 || stopped) return page;
      if (seconds === "stream" && !page.retry && page.cursor !== cursor) return page;
      cursor = page.cursor;
    }
  } finally {
    cancel?.();
    signal.removeEventListener("abort", stop);
  }
}
