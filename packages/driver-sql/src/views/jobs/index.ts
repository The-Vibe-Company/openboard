import { ORG_PURGE_RETENTION_MS } from "@openboard/core";
import {
  BACKFILL_BOARD_ORG_JOB,
  type BoardJobWriter,
  type BoardKeys,
  JOB_LEASE_MS,
  type JobLease,
  type JobPayload,
  type Jobs,
  PURGE_ORG_JOB,
  SCHEDULE_SEND_JOB,
  WEBHOOK_DELIVERY_JOB,
  WEBHOOK_RESEND_JOB,
} from "@openboard/ports";
import type { Db, Dialect } from "../../db.ts";
import { type Fragment, forUpdate, query, sql } from "../../sql.ts";
import { rateView } from "../rates/index.ts";
import { earlierDelivery } from "../webhooks/deliveries.ts";
import { backfillBoardOrgIds, backfillPlatformStatements, backfillStatements } from "./backfill-board-org.ts";
import { claimLegacyPurge, unqueued } from "./legacy-purge.ts";

const contentionRetryMs = 100;

const kinds: Fragment = {
  fragment: ({ name }) =>
    name === "postgres" ? "jsonb_array_elements_text(input.kinds::jsonb)" : "json_each(input.kinds)",
};
const skipLocked: Fragment = {
  fragment: ({ name }) => (name === "postgres" ? " FOR UPDATE SKIP LOCKED" : ""),
};

// A tombstone cannot run board writes. Skip its expiry jobs in both dispatch and the next timer.
const activeExpiryBoard: Fragment = {
  fragment:
    () => `(jobs.kind NOT IN ('task-expiry', '${SCHEDULE_SEND_JOB}', 'webhook-delivery', 'webhook-resend') OR EXISTS (
  SELECT 1 FROM boards b JOIN orgs o ON o.id = b.org_id
  WHERE b.id = jobs.board_id AND b.org_id = jobs.org_id AND b.deleted_at IS NULL AND o.deleted_at IS NULL
))`,
};

const webhookJobKinds = `('${WEBHOOK_DELIVERY_JOB}', '${WEBHOOK_RESEND_JOB}')`;
const webhookWindowMs = 60_000;
const webhookWindowLimit = 600;
const webhookRateKey = "webhook-delivery";
// Use the ordinary kind index until a cap fills. Then seek straight to each organization
// with queued webhook jobs so a capped backlog contributes only one row per webhook kind.
const dispatchScopes: Fragment = {
  fragment: (dialect) => `capped AS MATERIALIZED (
    SELECT r.org_id FROM tenant_rate_counters r CROSS JOIN input
    WHERE r.expires_at = input.window_end AND r.n >= ${webhookWindowLimit} AND r.key LIKE 'org:%:${webhookRateKey}'
  ),
  requested AS MATERIALIZED (SELECT value AS kind FROM input CROSS JOIN ${kinds.fragment(dialect)} AS job_kind),
  webhook_scopes (kind, org_id) AS (
    SELECT requested.kind, (SELECT jobs.org_id FROM jobs WHERE jobs.kind = requested.kind ORDER BY jobs.org_id LIMIT 1)
    FROM requested WHERE requested.kind IN ${webhookJobKinds} AND EXISTS (SELECT 1 FROM capped)
    UNION ALL
    SELECT webhook_scopes.kind, (
      SELECT jobs.org_id FROM jobs WHERE jobs.kind = webhook_scopes.kind AND jobs.org_id > webhook_scopes.org_id
      ORDER BY jobs.org_id LIMIT 1
    ) FROM webhook_scopes WHERE webhook_scopes.org_id IS NOT NULL
  ),
  scopes AS (
    SELECT kind, CAST(NULL AS BIGINT) AS org_id, 0 AS window_full FROM requested
    WHERE kind NOT IN ${webhookJobKinds} OR NOT EXISTS (SELECT 1 FROM capped)
    UNION ALL
    SELECT webhook_scopes.kind, webhook_scopes.org_id, CASE WHEN capped.org_id IS NULL THEN 0 ELSE 1 END
    FROM webhook_scopes LEFT JOIN capped ON capped.org_id = webhook_scopes.org_id
    WHERE webhook_scopes.org_id IS NOT NULL
  )`,
};

function dispatchParams(kinds: readonly string[], now: number) {
  const windowStart = Math.floor(now / webhookWindowMs) * webhookWindowMs;
  return { kinds: JSON.stringify(kinds), now, windowEnd: windowStart + webhookWindowMs };
}

const jobDelivery: Fragment = {
  fragment: ({ name }) => `FROM webhook_deliveries d
    JOIN webhooks w ON w.org_id = d.org_id AND w.board_id = d.board_id AND w.id = d.webhook AND w.enabled = 1
    WHERE d.org_id = jobs.org_id AND d.board_id = jobs.board_id
      AND d.id = ${name === "postgres" ? "jobs.payload::jsonb ->> 'id'" : "json_extract(jobs.payload, '$.id')"}`,
};

// A blocked follower must not keep the timer awake while its lane head waits.
// A scalar lookup keeps Postgres from precomputing blocked lanes for the whole outbox.
const readyDeliveryLane: Fragment = {
  fragment: (dialect) => `(jobs.kind NOT IN ${webhookJobKinds} OR (
    SELECT 1 ${jobDelivery.fragment(dialect)} AND ${earlierDelivery.fragment(dialect)} LIMIT 1
  ) IS NULL)`,
};

// A finishing runner immediately picks again. A waiting peer can sleep until
// the first slot could expire, unless newly enqueued work wakes it sooner.
const dispatchAt: Fragment = {
  fragment: (dialect) => `CASE WHEN jobs.kind IN ${webhookJobKinds} THEN
    ${dialect.name === "postgres" ? "GREATEST" : "MAX"}(jobs.available_at, COALESCE((
      SELECT (
        SELECT CASE WHEN COUNT(*) >= 4 OR COUNT(CASE WHEN active.thread IS NOT DISTINCT FROM d.thread THEN 1 END) > 0
          THEN MIN(active.lease_until) END
        FROM webhook_deliveries active
        WHERE active.org_id = d.org_id AND active.board_id = d.board_id AND active.webhook = d.webhook
          AND active.id <> d.id AND active.state = 'sending' AND active.lease_until > (SELECT at FROM input)
      ) ${jobDelivery.fragment(dialect)}
    ), jobs.available_at))
    ELSE jobs.available_at END`,
};

function dispatchLookup(body: (dialect: Dialect, filter: string) => string): Fragment {
  return {
    fragment: (dialect) => `CASE WHEN scopes.org_id IS NULL THEN (${body(dialect, "")})
      ELSE (${body(dialect, "AND jobs.org_id = scopes.org_id")}) END`,
  };
}

function scopeFilter(dialect: Dialect, filter: string) {
  return `jobs.kind = scopes.kind ${filter} AND ${activeExpiryBoard.fragment(dialect)}`;
}

const scopePick = dispatchLookup(
  (dialect, filter) => `SELECT id FROM jobs
    WHERE ${scopeFilter(dialect, filter)} AND available_at <= (SELECT at FROM input)
      AND ${readyDeliveryLane.fragment(dialect)} AND (${dispatchAt.fragment(dialect)}) <= (SELECT at FROM input)
    ORDER BY available_at, id LIMIT 1${skipLocked.fragment(dialect)}`,
);
const scopeDue = dispatchLookup(
  (dialect, filter) => `SELECT MIN(${dispatchAt.fragment(dialect)}) FROM jobs
    WHERE ${scopeFilter(dialect, filter)} AND ${readyDeliveryLane.fragment(dialect)}`,
);
const cappedDue: Fragment = {
  fragment: (
    dialect,
  ) => `SELECT ${dialect.name === "postgres" ? "GREATEST" : "MAX"}(available_at, (SELECT window_end FROM input))
    FROM jobs WHERE ${scopeFilter(dialect, "AND jobs.org_id = scopes.org_id")} ORDER BY available_at, id LIMIT 1`,
};

export const jobPlatformStatements = {
  // Dispatch runs before a board is known. These statements expose no payload or other board content.
  dueJobMetrics: sql`WITH RECURSIVE input AS (SELECT CAST(${"kinds"} AS TEXT) AS kinds, CAST(${"now"} AS BIGINT) AS at,
      CAST(${"windowEnd"} AS BIGINT) AS window_end),
    ${dispatchScopes},
    eligible_jobs AS (
      SELECT jobs.* FROM scopes JOIN jobs ON jobs.kind = scopes.kind WHERE scopes.org_id IS NULL
      UNION ALL
      SELECT jobs.* FROM scopes JOIN jobs ON jobs.kind = scopes.kind AND jobs.org_id = scopes.org_id
      WHERE scopes.window_full = 0
    )
    SELECT jobs.kind, COUNT(*) AS count, MIN(jobs.available_at) AS oldest
    FROM eligible_jobs jobs WHERE jobs.available_at <= ${"now"} AND ${activeExpiryBoard}
      AND ${readyDeliveryLane} AND (${dispatchAt}) <= ${"now"} GROUP BY jobs.kind`,
  // Materialize picks so choosing the oldest candidate does not re-run the locking subqueries.
  claimJob: sql`WITH RECURSIVE input AS (SELECT CAST(${"kinds"} AS TEXT) AS kinds, CAST(${"now"} AS BIGINT) AS at,
      CAST(${"windowEnd"} AS BIGINT) AS window_end),
    ${dispatchScopes},
    candidates AS MATERIALIZED (
      SELECT ${scopePick} AS id FROM scopes WHERE window_full = 0
    )
    UPDATE jobs SET available_at = ${"until"}, instance_id = ${"instanceId"}
    WHERE id = (
      SELECT id FROM candidates WHERE id IS NOT NULL
      ORDER BY (SELECT available_at FROM jobs candidate WHERE candidate.id = candidates.id), id LIMIT 1
    )
    RETURNING CAST(id AS TEXT) AS id, kind, org_id, board_id`,
  releaseJobs: sql`UPDATE jobs SET available_at = ${"now"}, instance_id = NULL
    WHERE instance_id = ${"instanceId"} AND available_at > ${"now"}
    AND id IS DISTINCT FROM CAST(${"exceptId"} AS BIGINT)
    RETURNING kind`,
  nextJob: sql`WITH RECURSIVE input AS (SELECT CAST(${"kinds"} AS TEXT) AS kinds, CAST(${"now"} AS BIGINT) AS at,
      CAST(${"windowEnd"} AS BIGINT) AS window_end),
    ${dispatchScopes}
    SELECT MIN(due) AS due FROM (
      SELECT CASE WHEN window_full = 1 THEN (${cappedDue}) ELSE ${scopeDue} END AS due FROM scopes
      UNION ALL
      SELECT MIN(o.deleted_at) + ${"retention"} AS due FROM orgs o WHERE ${"includeLegacy"} = 1 AND ${unqueued}
    ) AS due_jobs`,
};

export function dueJobMetrics(db: Db, dialect: Dialect): Jobs["dueMetrics"] {
  return async (kinds, now) => {
    const rows = await query(
      db,
      dialect,
      jobPlatformStatements.dueJobMetrics,
      dispatchParams([...new Set(kinds)], now),
    );
    const byKind = new Map(rows.map((row) => [row.kind, row]));
    return kinds.map((kind) => {
      const row = byKind.get(kind);
      return { kind, count: row ? Number(row.count) : 0, oldest: row ? Number(row.oldest) : null };
    });
  };
}

export const jobStatements = {
  enqueueJob: sql`INSERT INTO jobs (org_id, board_id, kind, available_at, payload)
    VALUES (${"orgId"}, ${"boardId"}, ${"kind"}, ${"dueAt"}, ${"payload"})`,
  // Keep the lease fenced through any state change made before takeJob in the same transaction.
  readLeasedJob: sql`SELECT payload FROM jobs WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}
    AND instance_id = ${"instanceId"} AND available_at = ${"until"} AND available_at > ${"now"}${forUpdate}`,
  extendJob: sql`UPDATE jobs SET available_at = ${"extendedUntil"}
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}
    AND instance_id = ${"instanceId"} AND available_at = ${"until"} AND available_at > ${"now"} RETURNING payload`,
  takeJob: sql`DELETE FROM jobs WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}
    AND instance_id = ${"instanceId"} AND available_at = ${"until"} AND available_at > ${"now"}
    RETURNING payload`,
};

export function claimJob(db: Db, dialect: Dialect): Jobs["claim"] {
  return async (kinds, lease) => {
    if (kinds.length === 0) return { job: null, nextDue: null };
    const { instanceId, claimedAt } = lease;
    const until = claimedAt + JOB_LEASE_MS;
    while (true) {
      try {
        return await db.transaction(async (tx) => {
          const [row] = await query(tx, dialect, jobPlatformStatements.claimJob, {
            ...dispatchParams(kinds, claimedAt),
            instanceId,
            until,
          });
          if (row) {
            const kind = String(row.kind);
            const orgId = Number(row.org_id);
            if (kind === WEBHOOK_DELIVERY_JOB || kind === WEBHOOK_RESEND_JOB) {
              const retry = await rateView(tx, dialect, `org:${orgId}:`).takeRate(
                webhookRateKey,
                webhookWindowLimit,
                webhookWindowMs,
                claimedAt,
              );
              if (retry !== undefined) throw new WebhookBudgetFilled();
            }
            return { job: { id: String(row.id), kind, orgId, boardId: Number(row.board_id) } };
          }
          const job = kinds.includes(PURGE_ORG_JOB) ? await claimLegacyPurge(tx, dialect, lease, until) : null;
          if (job) return { job };
          const due = await nextJob(tx, dialect, kinds, claimedAt);
          // SKIP LOCKED can miss a due row that is still visible to the MIN query.
          const nextDue = due !== null && due <= claimedAt ? claimedAt + contentionRetryMs : due;
          return { job: null, nextDue };
        });
      } catch (error) {
        // Another instance took the last slot after the pick's snapshot. Roll back the lease
        // and pick again with a fresh snapshot, which can now skip the capped organization.
        if (!(error instanceof WebhookBudgetFilled)) throw error;
      }
    }
  };
}

class WebhookBudgetFilled extends Error {}

export function releaseJobs(db: Db, dialect: Dialect, committed?: JobWrites["committed"]): Jobs["release"] {
  return async (instanceId, now, exceptId) => {
    const rows = await query(db, dialect, jobPlatformStatements.releaseJobs, {
      instanceId,
      now,
      exceptId: exceptId ?? null,
    });
    for (const row of rows) committed?.(String(row.kind), now);
  };
}

export async function nextJob(db: Db, dialect: Dialect, kinds: readonly string[], now: number): Promise<number | null> {
  const [row] = await query(db, dialect, jobPlatformStatements.nextJob, {
    ...dispatchParams(kinds, now),
    retention: ORG_PURGE_RETENTION_MS,
    includeLegacy: Number(kinds.includes(PURGE_ORG_JOB)),
  });
  return row?.due == null ? null : Number(row.due);
}

export interface JobWrites {
  readonly now: () => number;
  readonly committed: (kind: string, dueAt: number) => void;
  readonly refresh?: (kind: string) => void;
}

export async function readLeasedJob(
  tx: Db,
  dialect: Dialect,
  keys: BoardKeys,
  id: string,
  lease: JobLease,
  now: number,
): Promise<JobPayload | null> {
  const [row] = await query(tx, dialect, jobStatements.readLeasedJob, {
    ...keys,
    id,
    instanceId: lease.instanceId,
    until: lease.claimedAt + JOB_LEASE_MS,
    now,
  });
  return row ? (JSON.parse(String(row.payload)) as JobPayload) : null;
}

export async function extendLeasedJob(
  tx: Db,
  dialect: Dialect,
  keys: BoardKeys,
  id: string,
  lease: JobLease,
  now: number,
  extendedUntil: number,
): Promise<{ payload: JobPayload; lease: JobLease } | null> {
  const { instanceId, claimedAt } = lease;
  const [row] = await query(tx, dialect, jobStatements.extendJob, {
    ...keys,
    id,
    instanceId,
    until: claimedAt + JOB_LEASE_MS,
    now,
    extendedUntil,
  });
  return row
    ? { payload: JSON.parse(String(row.payload)), lease: { instanceId, claimedAt: extendedUntil - JOB_LEASE_MS } }
    : null;
}

export function jobWriter(tx: Db, dialect: Dialect, keys: BoardKeys, enqueued: JobWrites["committed"]): BoardJobWriter {
  return {
    async enqueue(kind, dueAt, payload) {
      await query(tx, dialect, jobStatements.enqueueJob, { ...keys, kind, dueAt, payload: JSON.stringify(payload) });
      enqueued(kind, dueAt);
    },
    readJob: (id, lease, now) => readLeasedJob(tx, dialect, keys, id, lease, now),
    async takeJob(id, { instanceId, claimedAt }, now) {
      const [row] = await query(tx, dialect, jobStatements.takeJob, {
        ...keys,
        id,
        instanceId,
        until: claimedAt + JOB_LEASE_MS,
        now,
      });
      return row ? JSON.parse(String(row.payload)) : null;
    },
  };
}

/** Queue one job per affected board, serializing concurrent startups against each other and the runner. */
export async function queueBoardOrgBackfill(
  db: Db,
  dialect: Dialect,
  jobs: JobWrites,
  now: number,
  signal?: AbortSignal,
): Promise<void> {
  let after = 0;
  while (!signal?.aborted) {
    const boards = await query(db, dialect, backfillPlatformStatements.backfillBoardPage, { after });
    if (boards.length === 0) return;
    for (const row of boards) {
      if (signal?.aborted) return;
      after = Number(row.board_id);
      if (Number(row.pending) === 0) continue;
      await enqueueBoardOrgBackfill(db, dialect, jobs, { orgId: Number(row.org_id), boardId: after }, now);
    }
  }
}

async function enqueueBoardOrgBackfill(db: Db, dialect: Dialect, jobs: JobWrites, keys: BoardKeys, now: number) {
  const queued = await db.transaction(async (tx) => {
    const [board] = await query(tx, dialect, backfillStatements.backfillLockBoard, keys);
    if (!board) return false;
    const kind = BACKFILL_BOARD_ORG_JOB;
    const [pending] = await query(tx, dialect, backfillStatements.queuedBoardOrgBackfill, { ...keys, kind });
    if (pending) return false;
    await jobWriter(tx, dialect, keys, () => {}).enqueue(kind, now, {});
    return true;
  });
  if (queued) jobs.committed(BACKFILL_BOARD_ORG_JOB, now);
}

export async function runBoardOrgBackfill(
  db: Db,
  dialect: Dialect,
  jobs: JobWrites,
  keys: BoardKeys,
  id: string,
  lease: JobLease,
  now: number,
): Promise<boolean> {
  let enqueued = false;
  const ran = await db.transaction(async (tx) => {
    // Soft-deleted organizations retain their data until purge. This lock only checks the stored keys.
    const [board] = await query(tx, dialect, backfillStatements.backfillLockBoard, keys);
    if (!board) return false;
    const writer = jobWriter(tx, dialect, keys, () => {
      enqueued = true;
    });
    if ((await writer.takeJob(id, lease, now)) === null) return false;
    if (await backfillBoardOrgIds(tx, dialect, keys)) await writer.enqueue(BACKFILL_BOARD_ORG_JOB, now, {});
    return true;
  });
  if (enqueued) jobs.committed(BACKFILL_BOARD_ORG_JOB, now);
  return ran;
}
