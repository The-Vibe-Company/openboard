import { ORG_PURGE_RETENTION_MS } from "@openboard/core";
import { claimJob, type Db, jobWake, nextJob, postgresText, releaseJobs } from "@openboard/driver-sql";
import type { Jobs } from "@openboard/ports";
import type { SQL } from "bun";

export function postgresJobs(sql: Pick<SQL, "listen">, db: Db, now: () => number): Jobs {
  return {
    claim: claimJob(db, postgresText),
    release: releaseJobs(db, postgresText),
    watch(kinds, schedule, wake) {
      const watcher = jobWake(now, schedule, () => nextJob(db, postgresText, kinds), wake);
      let stopped = false;
      let cancelRetry: (() => void) | undefined;

      async function listen() {
        if (stopped) return;
        try {
          // Bun calls onListen after the initial subscription and after each re-subscription.
          return await sql.listen("ob_jobs", (payload) => notify(payload, kinds, watcher), watcher.refresh);
        } catch {
          if (!stopped) cancelRetry = schedule(1_000, listenAgain);
        }
      }

      let listener = listen();
      function listenAgain() {
        listener = listen();
      }
      return () => {
        stopped = true;
        watcher.stop();
        cancelRetry?.();
        void listener.then((subscription) => subscription?.unlisten()).catch(() => undefined);
      };
    },
  };
}

function notify(payload: string, kinds: readonly string[], watcher: ReturnType<typeof jobWake>) {
  if (payload === "") {
    // A previous release emits an empty wake for near-due jobs during a rolling deploy.
    watcher.refresh();
    return;
  }
  try {
    const job: unknown = JSON.parse(payload);
    if (!Array.isArray(job)) return;
    const [kind, at, origin] = job;
    if (kinds.includes(kind) && Number.isSafeInteger(at)) {
      watcher.notify(origin === "tombstone" ? at + ORG_PURGE_RETENTION_MS : at);
    }
  } catch {
    // An invalid notification cannot identify a due job.
  }
}
