import type { BoardView } from "@openboard/ports";
import type { Deps } from "../deps.ts";

const MAX_WAIT_SECONDS = 120;

type Page = {
  readonly cursor: number;
  readonly head: number;
  readonly events: readonly unknown[];
  readonly retry?: boolean;
};

/** Read from storage on each wake, carrying the last scanned cursor across filtered pages. */
export async function longPoll<P extends Page>(
  board: BoardView,
  after: number | undefined,
  seconds: number | "stream" | undefined,
  signal: AbortSignal,
  schedule: Deps["schedule"],
  read: (after: number | undefined) => Promise<P>,
): Promise<P> {
  if (!seconds || signal.aborted) return read(after);

  let stopped = false;
  let wake: () => void = () => {};
  const stop = () => {
    stopped = true;
    wake();
  };
  // Register before reading so a commit between the read and the wait cannot be lost.
  const unsubscribe = board.subscribeEvents(after ?? 0, () => wake());
  signal.addEventListener("abort", stop, { once: true });
  let cancel: (() => void) | undefined;
  let cursor = after;
  try {
    if (seconds !== "stream") cancel = schedule(Math.min(seconds, MAX_WAIT_SECONDS) * 1000, stop);
    while (true) {
      const notified = new Promise<void>((resolve) => {
        wake = resolve;
      });
      const page = await read(cursor);
      if (page.events.length > 0 || stopped) return page;
      if (seconds === "stream" && !page.retry && page.cursor !== cursor) return page;
      cursor = page.cursor;
      // An empty filtered page can still have more stored rows behind it.
      if (!page.retry && cursor >= page.head) {
        await notified;
        if (stopped) return page;
      }
    }
  } finally {
    cancel?.();
    signal.removeEventListener("abort", stop);
    unsubscribe();
  }
}
