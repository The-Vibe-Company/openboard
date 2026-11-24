import { BoardError } from "@openboard/contract";

export const WATCHER_LEASE_MS = 5 * 60 * 1000;
export const WATCHER_MAX_TRIES = 5;

export function checkWatcherLease(match: { readonly lease: string | null } | null, lease: string): void {
  if (!match) throw new BoardError("no_match", "no match is waiting for this caller");
  if (match.lease !== lease) {
    throw new BoardError("stale_lease", "that lease is no longer current");
  }
}

export interface WatchFailed {
  readonly type: "watch.failed";
  readonly id: number;
  readonly at: number;
  readonly actor: string;
  readonly principal: string;
  readonly channel: string;
  readonly thread: number;
  readonly message: null;
  readonly visibility: 0;
  readonly payload: {
    readonly matched: string;
    readonly thread: string;
    readonly error: string;
    readonly watcher?: string;
  };
}

export function decideWatcherAck(
  attempt: number,
  now: number,
  { error, skip }: { readonly error?: string; readonly skip?: boolean },
) {
  if (skip || error === undefined) return { kind: "drop" } as const;
  if (attempt + 1 >= WATCHER_MAX_TRIES) return { kind: "failed", error } as const;
  return { kind: "retry", attempt: attempt + 1, nextAt: now + 1000 * 2 ** attempt } as const;
}
