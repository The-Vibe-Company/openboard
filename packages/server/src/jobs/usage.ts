import { USAGE_ROLLUP_JOB } from "@openboard/ports";
import type { JobHandlers } from "./registry.ts";

export const usageJobs: JobHandlers = Object.freeze({
  [USAGE_ROLLUP_JOB]: {
    run: (org, job, lease, now) => org.rollupUsage(job.boardId, job.id, lease, now),
  },
});
