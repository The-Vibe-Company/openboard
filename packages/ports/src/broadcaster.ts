import type { BoardScope } from "./store.ts";

/** Board-scoped wake-ups. The event store is the source of truth. */
export interface Broadcaster {
  /** Announce a new head only after its write commits. */
  publish(scope: BoardScope, position: number): void;
  /** Wake on positions above the given cursor. Register before reading; subscriptions do not replay. */
  subscribe(scope: BoardScope, fromPosition: number, wake: () => void): () => void;
}
