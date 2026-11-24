import { EXPORT_ORG_JOB, EXPORT_RUN_MS, type Bucket, type Jobs } from "@openboard/ports";
import type { Deps } from "../deps.ts";
import type { Tenants } from "../http/scope.ts";
import { exportArchive } from "./export-archive.ts";
import { startJobs } from "./registry.ts";
import { orgPrefix } from "./ship-log.ts";

export function startExportJobs(
  jobs: Jobs,
  tenants: Tenants,
  deps: Deps,
  instance: string | undefined,
  bucket: Bucket,
  onActivity: () => Promise<void>,
) {
  return startJobs(
    jobs,
    tenants,
    deps,
    instance,
    {
      [EXPORT_ORG_JOB]: {
        async run(org, job, lease) {
          return org.runExport(
            job,
            lease,
            deps.now,
            async (key, source, progress) => {
              const stall = new AbortController();
              const arm = () => deps.schedule(EXPORT_RUN_MS, () => stall.abort());
              let cancel = arm();
              try {
                const monitor = new TransformStream<Uint8Array, Uint8Array>({
                  async transform(chunk, controller) {
                    if (await progress()) {
                      cancel();
                      cancel = arm();
                    }
                    controller.enqueue(chunk);
                  },
                });
                const archive = exportArchive(bucket, orgPrefix(job.orgId), source);
                await bucket.putStream(key, archive.pipeThrough(monitor, { signal: stall.signal }));
                stall.signal.throwIfAborted();
              } finally {
                cancel();
              }
            },
            (key) => bucket.delete(key),
          );
        },
      },
    },
    undefined,
    onActivity,
  );
}
