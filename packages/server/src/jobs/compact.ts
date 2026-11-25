import type { BoardKeys, CompactionCursor, PlatformView } from "@openboard/ports";
import type { Deps } from "../deps.ts";
import { errorMessage } from "../log.ts";

const retention = 30 * 86_400_000;
const interval = 60_000;
const windowsPerWake = 32;

export function compactOnActivity(platform: PlatformView, deps: Deps, requiresShipping: boolean, signal: AbortSignal) {
  let next = deps.now() + interval;
  let running: Promise<void> | undefined;
  let closed = false;
  let afterBoard = 0;
  let boards: readonly BoardKeys[] = [];
  let cursor: CompactionCursor | undefined;
  let cutoff = 0;
  const stopped = () => closed || signal.aborted;

  async function compact(now: number) {
    if (boards.length === 0) boards = await platform.compactionBoards(afterBoard, windowsPerWake);
    if (boards.length === 0 && afterBoard > 0) {
      afterBoard = 0;
      boards = await platform.compactionBoards(afterBoard, windowsPerWake);
    }
    for (let step = 0; step < windowsPerWake && !stopped(); step++) {
      const keys = boards[0];
      if (!keys) return;
      if (!cursor) cutoff = now - retention;
      try {
        const result = await platform.compactActorSightings(keys, cutoff, requiresShipping, cursor);
        if (result.next) {
          cursor = result.next;
          continue;
        }
      } catch (error) {
        deps.log.error("board event log compaction failed", { boardId: keys.boardId, error: errorMessage(error) });
      }
      afterBoard = keys.boardId;
      boards = boards.slice(1);
      cursor = undefined;
    }
  }

  return {
    async run() {
      const now = deps.now();
      if (running || now < next || stopped()) return;
      next = now + interval;
      running = compact(now).catch((error) =>
        deps.log.error("event log compaction failed", { error: errorMessage(error) }),
      );
      try {
        await running;
      } finally {
        running = undefined;
      }
    },
    close() {
      closed = true;
      return running;
    },
  };
}
