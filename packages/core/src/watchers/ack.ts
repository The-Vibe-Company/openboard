import { BoardError } from "@openboard/contract";

export const WATCHER_LEASE_MS = 5 * 60 * 1000;

export function checkWatcherLease(match: { readonly lease: string | null } | null, lease: string): void {
  if (!match) throw new BoardError("no_match", "no match is waiting for this caller");
  if (match.lease !== lease) {
    throw new BoardError("stale_lease", "that lease is no longer current");
  }
}
