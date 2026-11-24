import { claimJob, type Db, dueJobMetrics, jobWake, nextJob, releaseJobs } from "@openboard/driver-sql";
import type { Jobs } from "@openboard/ports";
import { sqliteDialect } from "./dialect.ts";

export function sqliteJobs(
  db: Db,
  now: () => number,
): Jobs & { committed(kind: string, dueAt: number): void; close(): void } {
  const watchers = new Map<ReturnType<typeof jobWake>, readonly string[]>();
  function committed(kind: string, dueAt: number) {
    for (const [watcher, kinds] of watchers) {
      if (kinds.includes(kind)) watcher.notify(dueAt);
    }
  }
  return {
    dueMetrics: dueJobMetrics(db, sqliteDialect),
    claim: claimJob(db, sqliteDialect),
    release: releaseJobs(db, sqliteDialect, committed),
    committed,
    close() {
      for (const watcher of watchers.keys()) watcher.stop();
      watchers.clear();
    },
    watch(kinds, schedule, wake) {
      const watcher = jobWake(now, schedule, () => nextJob(db, sqliteDialect, kinds, now()), wake);
      watchers.set(watcher, kinds);
      watcher.refresh();
      return () => {
        watcher.stop();
        watchers.delete(watcher);
      };
    },
  };
}
