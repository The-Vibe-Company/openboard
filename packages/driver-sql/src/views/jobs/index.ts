import { type BoardJobWriter, type BoardKeys, type Jobs, PURGE_ORG_JOB } from "@openboard/ports";
import type { Db, Dialect } from "../../db.ts";
import { type Fragment, query, sql } from "../../sql.ts";

import { claimLegacyPurge, nextLegacyPurge } from "./legacy-purge.ts";

const leaseMs = 30_000;

const kinds: Fragment = {
  fragment: ({ name }) =>
    name === "postgres" ? "jsonb_array_elements_text(input.kinds::jsonb)" : "json_each(input.kinds)",
};
const skipLocked: Fragment = {
  fragment: ({ name }) => (name === "postgres" ? " FOR UPDATE SKIP LOCKED" : ""),
};
const notify: Fragment = {
  fragment: ({ name }) => (name === "postgres" ? "pg_notify('ob_jobs', '')" : "NULL"),
};

const kindSet: Fragment = {
  fragment: (dialect) => `SELECT value FROM input CROSS JOIN ${kinds.fragment(dialect)} AS job_kind`,
};

export const jobPlatformStatements = {
  // Dispatch runs before a board is known. These statements expose no payload or other board content.
  claimJob: sql`WITH input AS (SELECT CAST(${"kinds"} AS TEXT) AS kinds)
    UPDATE jobs SET available_at = ${"until"}, instance_id = ${"instanceId"}
    WHERE id = (
      SELECT id FROM jobs WHERE kind IN (${kindSet}) AND available_at <= ${"now"}
      ORDER BY available_at, id LIMIT 1${skipLocked}
    )
    RETURNING CAST(id AS TEXT) AS id, kind, org_id, board_id`,
  releaseJobs: sql`UPDATE jobs SET available_at = ${"now"}, instance_id = NULL
    WHERE instance_id = ${"instanceId"} AND available_at > ${"now"}
    AND id IS DISTINCT FROM CAST(${"exceptId"} AS BIGINT)`,
  nextJob: sql`WITH input AS (SELECT CAST(${"kinds"} AS TEXT) AS kinds)
    SELECT MIN(available_at) AS due FROM jobs WHERE kind IN (${kindSet})`,
};

export const jobStatements = {
  enqueueJob: sql`INSERT INTO jobs (org_id, board_id, kind, available_at, payload)
    VALUES (${"orgId"}, ${"boardId"}, ${"kind"}, ${"dueAt"}, ${"payload"})`,
  notifyJobs: sql`SELECT ${notify}`,
  takeJob: sql`DELETE FROM jobs WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}
    AND instance_id = ${"instanceId"} AND available_at = ${"until"} AND available_at > ${"now"}
    RETURNING payload`,
};

export function claimJob(db: Db, dialect: Dialect): Jobs["claim"] {
  return async (kinds, lease) => {
    if (kinds.length === 0) return null;
    const { instanceId, claimedAt } = lease;
    const until = claimedAt + leaseMs;
    return db.transaction(async (tx) => {
      const [row] = await query(tx, dialect, jobPlatformStatements.claimJob, {
        kinds: JSON.stringify(kinds),
        instanceId,
        now: claimedAt,
        until,
      });
      if (row)
        return { id: String(row.id), kind: String(row.kind), orgId: Number(row.org_id), boardId: Number(row.board_id) };
      return kinds.includes(PURGE_ORG_JOB) ? claimLegacyPurge(tx, dialect, lease, until) : null;
    });
  };
}

export function releaseJobs(db: Db, dialect: Dialect): Jobs["release"] {
  return async (instanceId, now, exceptId) => {
    await query(db, dialect, jobPlatformStatements.releaseJobs, { instanceId, now, exceptId: exceptId ?? null });
  };
}

export async function nextJob(db: Db, dialect: Dialect, kinds: readonly string[]): Promise<number | null> {
  const [row] = await query(db, dialect, jobPlatformStatements.nextJob, { kinds: JSON.stringify(kinds) });
  const queued = row?.due == null ? null : Number(row.due);
  const legacy = kinds.includes(PURGE_ORG_JOB) ? await nextLegacyPurge(db, dialect) : null;
  return queued === null ? legacy : legacy === null ? queued : Math.min(queued, legacy);
}

export interface JobWrites {
  readonly now: () => number;
  readonly committed: () => void;
}

export function jobWriter(
  tx: Db,
  dialect: Dialect,
  keys: BoardKeys,
  jobs: JobWrites,
  enqueued: () => void,
): BoardJobWriter {
  return {
    async enqueue(kind, dueAt, payload) {
      await query(tx, dialect, jobStatements.enqueueJob, { ...keys, kind, dueAt, payload: JSON.stringify(payload) });
      if (dialect.name === "postgres" && dueAt <= jobs.now() + 1000) {
        await query(tx, dialect, jobStatements.notifyJobs, {});
      }
      enqueued();
    },
    async takeJob(id, { instanceId, claimedAt }, now) {
      const [row] = await query(tx, dialect, jobStatements.takeJob, {
        ...keys,
        id,
        instanceId,
        until: claimedAt + leaseMs,
        now,
      });
      return row ? JSON.parse(String(row.payload)) : null;
    },
  };
}
