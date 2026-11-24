import { PURGE_ORG_JOB } from "@openboard/ports";
import type { OrgJobHandler } from "./registry.ts";
import { orgPrefix } from "./ship-log.ts";

const purgeOrg: OrgJobHandler = {
  run: (org, job, lease, now, bucket) =>
    org.purgeOrg(job.boardId, job.id, lease, now, bucket && (() => bucket.deletePrefix(orgPrefix(job.orgId)))),
};

export const maintenanceJobs = Object.freeze({ [PURGE_ORG_JOB]: purgeOrg });
