import { BACKFILL_BOARD_ORG_JOB, PURGE_ORG_JOB } from "@openboard/ports";
import type { JobHandlers, OrgJobHandler } from "./registry.ts";
import { orgPrefix } from "./ship-log.ts";

const purgeOrg: OrgJobHandler = {
  run: (org, job, lease, now, bucket) =>
    org.purgeOrg(
      job.boardId,
      job.id,
      lease,
      now,
      bucket &&
        (async () => {
          await bucket.deletePrefix(orgPrefix(job.orgId));
          await bucket.deletePrefix(`exports/${job.orgId}/`);
        }),
    ),
};

export const maintenanceJobs: JobHandlers = Object.freeze({
  [PURGE_ORG_JOB]: purgeOrg,
  [BACKFILL_BOARD_ORG_JOB]: {
    run: (org, job, lease, now) => org.backfillBoardOrgIds(job.boardId, job.id, lease, now),
  },
});
