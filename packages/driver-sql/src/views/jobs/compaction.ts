import type { PlatformView } from "@openboard/ports";
import type { Db, Dialect } from "../../db.ts";
import { type Fragment, query, sql } from "../../sql.ts";

const batchSize = 1000;
const skipLocked: Fragment = {
  fragment: ({ name }) => (name === "postgres" ? " FOR UPDATE OF candidate SKIP LOCKED" : ""),
};

export const compactionDiscovery = {
  compactionBoards: sql`SELECT b.id, b.org_id FROM boards b JOIN orgs o ON o.id = b.org_id
    WHERE b.id > ${"after"} AND b.deleted_at IS NULL AND o.deleted_at IS NULL
    ORDER BY b.id LIMIT ${"limit"}`,
};

export const compactionStatements = {
  compactionWindow: sql`SELECT at, id FROM events WHERE org_id = ${"orgId"} AND board_id = ${"boardId"}
    AND type = 'actor.seen' AND visibility = 1 AND at < ${"cutoff"}
    AND (at, id) > (${"afterAt"}, ${"afterId"})
    ORDER BY at, id LIMIT 1 OFFSET ${"offset"}`,
  compactActorSightings: sql`WITH picked AS MATERIALIZED (
    SELECT candidate.board_id, candidate.id FROM events candidate
    LEFT JOIN shipping s ON s.org_id = candidate.org_id AND s.board_id = candidate.board_id
    WHERE candidate.org_id = ${"orgId"} AND candidate.board_id = ${"boardId"}
      AND candidate.type = 'actor.seen' AND candidate.visibility = 1
      AND (candidate.at, candidate.id) > (${"afterAt"}, ${"afterId"})
      AND (candidate.at, candidate.id) <= (${"endAt"}, ${"endId"})
      AND candidate.at < ${"cutoff"} AND (${"requiresShipping"} = 0 OR candidate.id <= s.shipped)
      AND NOT EXISTS (SELECT 1 FROM usage_pending_days u WHERE u.org_id = ${"orgId"}
        AND u.job_key = CAST(candidate.at - (candidate.at % 86400000 + 86400000) % 86400000 AS TEXT))
      AND candidate.id > (SELECT earlier.id FROM events earlier WHERE earlier.org_id = ${"orgId"} AND earlier.board_id = ${"boardId"}
        AND earlier.type = 'actor.seen' AND earlier.visibility = 1 AND earlier.actor = candidate.actor
        ORDER BY earlier.id LIMIT 1)
      AND candidate.id < (SELECT later.id FROM events later WHERE later.org_id = ${"orgId"} AND later.board_id = ${"boardId"}
        AND later.type = 'actor.seen' AND later.visibility = 1 AND later.actor = candidate.actor
        ORDER BY later.id DESC LIMIT 1)
    ORDER BY candidate.at, candidate.id LIMIT ${"limit"}${skipLocked}
  )
  DELETE FROM events WHERE org_id = ${"orgId"} AND board_id = ${"boardId"}
    AND id IN (SELECT candidate.id FROM picked candidate WHERE candidate.board_id = ${"boardId"}) RETURNING id`,
};

export function compactionView(
  db: Db,
  dialect: Dialect,
): Pick<PlatformView, "compactionBoards" | "compactActorSightings"> {
  return {
    async compactionBoards(after, limit) {
      const rows = await query(db, dialect, compactionDiscovery.compactionBoards, { after, limit });
      return rows.map(({ id, org_id }) => ({ boardId: Number(id), orgId: Number(org_id) }));
    },
    async compactActorSightings(keys, cutoff, requiresShipping, after) {
      const params = { ...keys, cutoff, afterAt: after?.at ?? Number.MIN_SAFE_INTEGER, afterId: after?.id ?? 0 };
      const [end] = await query(db, dialect, compactionStatements.compactionWindow, {
        ...params,
        offset: batchSize - 1,
      });
      const next = end ? { at: Number(end.at), id: Number(end.id) } : undefined;
      // Bound endpoint and usage lookups even when every sighting in the window must be kept.
      const rows = await query(db, dialect, compactionStatements.compactActorSightings, {
        ...params,
        endAt: next?.at ?? cutoff,
        endId: next?.id ?? 0,
        requiresShipping: Number(requiresShipping),
        limit: batchSize,
      });
      return { deleted: rows.length, next };
    },
  };
}
