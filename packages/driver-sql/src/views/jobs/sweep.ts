import type { PlatformView } from "@openboard/ports";
import type { Db, Dialect } from "../../db.ts";
import { type Fragment, query, sql } from "../../sql.ts";

const day = 86_400_000;
const skipLocked: Fragment = {
  fragment: ({ name }) => (name === "postgres" ? " FOR UPDATE OF candidate SKIP LOCKED" : ""),
};

// Each call uses static schema identifiers and a matching retention index. Lock the picked rows
// before deleting so a concurrent retry or sweep cannot change the batch underneath us.
function expiredBatch(table: string, key: string, time: string, state = "1 = 1", inclusive = false) {
  const target: Fragment = { fragment: () => table };
  const keys: Fragment = { fragment: () => key };
  const timeColumn: Fragment = { fragment: () => time };
  const eligible: Fragment = { fragment: () => state };
  const comparison: Fragment = { fragment: () => (inclusive ? "<=" : "<") };
  const composite = key.includes(",");
  const match: Fragment = { fragment: () => (composite ? `(${key})` : key) };
  return sql`WITH picked AS MATERIALIZED (
    SELECT ${keys} FROM ${target} AS candidate WHERE ${eligible} AND ${timeColumn} ${comparison} ${"cutoff"}
    ORDER BY ${timeColumn} LIMIT 1000${skipLocked}
  )
  DELETE FROM ${target} WHERE ${match} IN (SELECT ${keys} FROM picked)`;
}

// An outage can outlast delivery retention. Preserve source rows until their day is recorded.
const deliveryNotPending = `NOT EXISTS (SELECT 1 FROM usage_pending_days u WHERE u.org_id = candidate.org_id
  AND u.job_key = CAST(candidate.created_at - (candidate.created_at % 86400000 + 86400000) % 86400000 AS TEXT))`;

export const sweepStatements = {
  sweepFinishedDeliveries: expiredBatch(
    "webhook_deliveries",
    "id",
    "done_at",
    `state IN ('done', 'skipped') AND ${deliveryNotPending}`,
  ),
  sweepDeadDeliveries: expiredBatch("webhook_deliveries", "id", "done_at", `state = 'dead' AND ${deliveryNotPending}`),
  sweepInboundSeen: expiredBatch("inbound_seen", "endpoint, event_id", "at"),
  sweepWatcherMatches: expiredBatch("watcher_matches", "board_id, id", "next_at", "state = 'done'"),
  sweepSessions: expiredBatch("sessions", "id_hash", "expires_at", undefined, true),
  sweepDeviceCodes: expiredBatch("device_codes", "device_hash", "expires_at", undefined, true),
  sweepAcceptedInvitations: expiredBatch("invitations", "id", "accepted_at", "accepted_at IS NOT NULL"),
  sweepExpiredInvitations: expiredBatch("invitations", "id", "expires_at", "accepted_at IS NULL"),
};

const retention = {
  sweepFinishedDeliveries: 7 * day,
  sweepDeadDeliveries: 30 * day,
  sweepInboundSeen: 7 * day,
  sweepWatcherMatches: day,
  sweepSessions: 0,
  sweepDeviceCodes: 0,
  sweepAcceptedInvitations: 90 * day,
  sweepExpiredInvitations: 90 * day,
} satisfies Record<keyof typeof sweepStatements, number>;

export function sweepView(db: Db, dialect: Dialect): Pick<PlatformView, "sweepExpired"> {
  return {
    async sweepExpired(now) {
      for (const name of Object.keys(retention) as (keyof typeof retention)[]) {
        await query(db, dialect, sweepStatements[name], { cutoff: now - retention[name] });
      }
    },
  };
}
