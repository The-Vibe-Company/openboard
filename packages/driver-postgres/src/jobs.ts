import { claimJob, type Db, postgresText, releaseJobs } from "@openboard/driver-sql";
import type { Jobs } from "@openboard/ports";
import type { SQL } from "bun";

export function postgresJobs(sql: SQL, db: Db): Jobs {
  return {
    claim: claimJob(db, postgresText),
    release: releaseJobs(db, postgresText),
    watch(_kinds, schedule, wake) {
      let stopped = false;
      const listener = sql
        .listen("ob_jobs", () => {
          if (!stopped) void wake();
        })
        .catch(() => undefined);
      function poll() {
        return schedule(1000, async () => {
          try {
            await wake();
          } finally {
            if (!stopped) cancel = poll();
          }
        });
      }
      let cancel = poll();
      return () => {
        stopped = true;
        cancel();
        void listener.then((subscription) => subscription?.unlisten()).catch(() => undefined);
      };
    },
  };
}
