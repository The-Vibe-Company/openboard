import { PURGE_ORG_JOB } from "@openboard/ports";
import type { OrgJobHandler } from "./registry.ts";

const purgeOrg: OrgJobHandler = {
  run: (org, job, lease, now) => org.purgeOrg(job.boardId, job.id, lease, now),
};

export const maintenanceJobs = Object.freeze({ [PURGE_ORG_JOB]: purgeOrg });
