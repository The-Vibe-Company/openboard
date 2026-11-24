import { dailyEventWindow } from "@openboard/core";
import { type OrgScope, type OrgView, USAGE_ROLLUP_JOB } from "@openboard/ports";
import type { Db, Dialect } from "../../db.ts";
import { query, sql } from "../../sql.ts";
import { messageBytes } from "../boards.ts";
import { type JobWrites, jobWriter } from "./index.ts";
import { purgeStatements } from "./purge.ts";

const dayMs = 86_400_000;

export const usageStatements = {
  recordedUsageDay: sql`SELECT 1 FROM usage_daily WHERE org_id = ${"orgId"} AND day = ${"day"}`,
  insertUsageDay: sql`INSERT INTO usage_daily (org_id, day, events, bytes_stored, deliveries, active_agents)
    SELECT ${"orgId"}, ${"day"}, COUNT(*),
      (SELECT COALESCE(SUM(CASE WHEN b.stored_bytes_head = b.head THEN b.stored_bytes ELSE (
        SELECT COALESCE(SUM(${messageBytes}), 0) FROM messages m
        WHERE m.org_id = ${"orgId"} AND m.board_id = b.id AND m.deleted = 0
      ) END), 0) FROM boards b WHERE b.org_id = ${"orgId"}),
      (SELECT COUNT(*) FROM webhook_deliveries d WHERE d.org_id = ${"orgId"}
        AND d.created_at >= ${"day"} AND d.created_at < ${"end"}),
      COUNT(DISTINCT CASE WHEN e.actor LIKE 'ob:conn:%+%' AND e.type <> 'actor.seen' THEN e.actor END)
    FROM boards b JOIN events e ON e.board_id = b.id AND e.org_id = b.org_id
    WHERE b.org_id = ${"orgId"} AND e.org_id = ${"orgId"} AND e.at >= ${"day"} AND e.at < ${"end"}
    ON CONFLICT (org_id, day) DO NOTHING RETURNING org_id`,
};

export function notifyUsageDay(at: number, committed: JobWrites["committed"]) {
  committed(USAGE_ROLLUP_JOB, dailyEventWindow(at).nextDay);
}

export function usageView(
  db: Db,
  dialect: Dialect,
  { orgId }: OrgScope,
  jobs: JobWrites,
): Pick<OrgView, "rollupUsage"> {
  return {
    rollupUsage: (boardId, id, lease, now) =>
      db.transaction(async (tx) => {
        // Board writes share the organization lock. Wait for their commits before taking the snapshot.
        const keys = { orgId, boardId };
        const [org] = await query(tx, dialect, purgeStatements.purge_lock_org, keys);
        if (!org) return false;
        const takenAt = Math.max(now, jobs.now());
        const job = await jobWriter(tx, dialect, keys, () => {}).takeJob(id, lease, takenAt);
        if (!job) return false;
        const day = job.day;
        if (typeof day !== "number" || !Number.isSafeInteger(day) || day % dayMs !== 0 || day + dayMs > takenAt) {
          throw new Error("invalid usage rollup day");
        }
        if ((await query(tx, dialect, usageStatements.recordedUsageDay, { orgId, day })).length) return false;
        return (await query(tx, dialect, usageStatements.insertUsageDay, { orgId, day, end: day + dayMs })).length > 0;
      }),
  };
}
