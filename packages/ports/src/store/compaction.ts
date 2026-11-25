import type { BoardKeys } from "../tenant-scope.ts";

export interface CompactionCursor {
  readonly at: number;
  readonly id: number;
}

export interface Compaction {
  /** Discover live board routing keys in ascending order for maintenance. */
  compactionBoards(after: number, limit: number): Promise<readonly BoardKeys[]>;
  /** Scan and compact one bounded window of old sightings without the board lock. */
  compactActorSightings(
    keys: BoardKeys,
    cutoff: number,
    requiresShipping: boolean,
    after?: CompactionCursor,
  ): Promise<{ deleted: number; next?: CompactionCursor }>;
}
