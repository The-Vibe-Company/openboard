import { claimJob, type Db, nextJob, releaseJobs } from "@openboard/driver-sql";
import type { Jobs } from "@openboard/ports";
import { sqliteDialect } from "./dialect.ts";

export function sqliteJobs(db: Db, now: () => number): Jobs & { committed(): void; close(): void } {
  let refresh: (() => void) | undefined;
  let stop: (() => void) | undefined;
  return {
    claim: claimJob(db, sqliteDialect),
    release: releaseJobs(db, sqliteDialect),
    committed: () => refresh?.(),
    close: () => stop?.(),
    watch(kinds, schedule, wake) {
      let generation = 0;
      let cancel: (() => void) | undefined;
      let active = true;
      let running = false;

      async function arm() {
        const current = ++generation;
        cancel?.();
        const due = await nextJob(db, sqliteDialect, kinds).catch(() => now() + 1000);
        if (!active || running || current !== generation || due === null) return;
        // A driver timer cannot represent a delay larger than a signed 32-bit integer.
        cancel = schedule(Math.min(2_147_483_647, Math.max(0, due - now())), async () => {
          running = true;
          try {
            await wake();
          } finally {
            running = false;
            if (active) await arm();
          }
        });
      }

      stop?.();
      refresh = () => {
        void arm();
      };
      stop = () => {
        active = false;
        cancel?.();
        refresh = undefined;
        stop = undefined;
      };
      void arm();
      return stop;
    },
  };
}
