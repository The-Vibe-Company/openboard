import type { BoardEvent } from "@openboard/core";
import type { BoardMessageReads } from "./board-message-reads.ts";
import type { BoardScope } from "./store.ts";

/** The events one commit appended, in position order: every position after `after`, up to `head`. */
export interface CommittedPage {
  readonly after: number;
  readonly head: number;
  readonly events: readonly BoardEvent[];
}

type EventRead = Parameters<BoardMessageReads["readEvents"]>[1];
type EventPage = Awaited<ReturnType<BoardMessageReads["readEvents"]>>;

/** A committed page as the feed reads it, from memory. */
export interface CommittedEvents {
  readonly after: number;
  readonly head: number;
  /**
   * The page `readEvents(after, filters)` reads right after this commit, or undefined when only the store can
   * answer it: a newest read, or a filter that matches an earlier version or the thread root.
   */
  read(filters?: EventRead): EventPage | undefined;
}

/** Board-scoped wake-ups. The event store is the source of truth. */
export interface Broadcaster {
  /** Announce a new head and the events that reached it, only after their write commits. */
  publish(scope: BoardScope, page: CommittedPage): void;
  /**
   * Wake on heads above the given cursor. Register before reading; subscriptions do not replay. A wake carries the
   * committed page when the commit's events are in memory, and nothing when the subscriber must read the store.
   */
  subscribe(scope: BoardScope, fromPosition: number, wake: (page?: CommittedPage) => void): () => void;
}
