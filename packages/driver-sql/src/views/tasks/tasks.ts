import type { Message } from "@openboard/contract";
import type { BoardKeys, BoardTaskReads, BoardTaskWriter } from "@openboard/ports";
import type { Db, Dialect, Row } from "../../db.ts";
import { type Fragment, query, sql } from "../../sql.ts";
import { splice } from "../threads.ts";

export const needIds = {
  fragment: ({ name }: Dialect) =>
    name === "sqlite" ? "json_each(input.ids)" : "jsonb_array_elements_text(input.ids::jsonb)",
};

const CHANNELS: Fragment = { fragment: () => "" };
const readyTask = sql`SELECT m.view FROM tasks t
  JOIN messages m ON m.org_id = t.org_id AND m.board_id = t.board_id AND m.id = t.id
  WHERE t.org_id = ${"orgId"} AND t.board_id = ${"boardId"} AND m.deleted = 0
    AND ${CHANNELS} AND t.state IN ('ready', 'claimed')
    AND (t.state = 'ready' OR (t.claim_until <= CAST(${"now"} AS BIGINT) AND t.blocked_reason IS NULL))
    AND t.owner = ${"principal"} AND (t.for_actor = ${"actor"} OR t.for_actor IS NULL)
  ORDER BY CASE WHEN t.for_actor IS NULL THEN 1 ELSE 0 END, t.id LIMIT 1`;

export const taskReadStatements = {
  nextReadyTask: splice(readyTask, CHANNELS, sql`t.channel = ${"channel"}`),
  nextReadySubtreeTask: splice(
    readyTask,
    CHANNELS,
    sql`(t.channel = ${"channel"} OR t.channel LIKE ${"under"} ESCAPE '\\')`,
  ),
  taskBatch: sql<"orgId" | "boardId" | "principal" | "id">`WITH input AS (
    SELECT digest, tasks AS ids FROM task_batches
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND principal = ${"principal"} AND id = ${"id"}
  )
    SELECT input.digest, input.ids, m.id, m.view FROM input CROSS JOIN ${needIds} AS root
    JOIN messages m ON m.id = CAST(root.value AS BIGINT)
    WHERE m.org_id = ${"orgId"} AND m.board_id = ${"boardId"}`,
  taskClaimProof: sql`SELECT claim_token, claim_until FROM tasks
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}`,
  taskNeeds: sql<"ids" | "orgId" | "boardId">`WITH input AS (SELECT CAST(${"ids"} AS TEXT) AS ids)
    SELECT m.view FROM input CROSS JOIN ${needIds} AS need
    JOIN messages m ON m.id = CAST(need.value AS BIGINT)
    JOIN tasks t ON t.org_id = m.org_id AND t.board_id = m.board_id AND t.id = m.id
    WHERE m.org_id = ${"orgId"} AND m.board_id = ${"boardId"}`,
  taskNeedEdges: sql<"ids" | "orgId" | "boardId">`WITH input AS (SELECT CAST(${"ids"} AS TEXT) AS ids)
    SELECT e.needs, t.channel, t.state
    FROM input CROSS JOIN ${needIds} AS need
    JOIN tasks t ON t.id = CAST(need.value AS BIGINT)
    JOIN task_needs e ON e.board_id = t.board_id AND e.task = t.id
      AND (e.org_id = t.org_id OR e.org_id IS NULL)
    WHERE t.org_id = ${"orgId"} AND t.board_id = ${"boardId"}`,
  taskDependants: sql`SELECT CASE WHEN t.state = 'waiting' AND t.waiting_on = 1 THEN m.view END AS view
    FROM task_needs n
    JOIN tasks t ON t.org_id = n.org_id AND t.board_id = n.board_id AND t.id = n.task
    JOIN messages m ON m.org_id = t.org_id AND m.board_id = t.board_id AND m.id = t.id
    WHERE n.org_id = ${"orgId"} AND n.board_id = ${"boardId"} AND n.needs = ${"id"}
    ORDER BY n.task`,
  taskRoot: sql`SELECT m.view FROM tasks t
    JOIN messages m ON m.org_id = t.org_id AND m.board_id = t.board_id AND m.id = t.id
    WHERE t.org_id = ${"orgId"} AND t.board_id = ${"boardId"} AND t.id = ${"id"}`,
};

export function taskReads(db: Db, dialect: Dialect, keys: BoardKeys): Pick<BoardTaskReads, "taskRoot" | "taskBatch"> {
  return {
    async taskBatch(principal, id) {
      const rows = await query(db, dialect, taskReadStatements.taskBatch, { ...keys, principal, id });
      const [first] = rows;
      if (!first) return null;
      const byId = new Map(rows.map((row) => [String(row.id), JSON.parse(String(row.view)) as Message]));
      const roots = (JSON.parse(String(first.ids)) as string[]).map((root) => {
        const message = byId.get(root);
        if (!message) throw new Error("missing stored batch root");
        return message;
      });
      return { digest: String(first.digest), roots };
    },
    async taskRoot(id) {
      const [row] = await query(db, dialect, taskReadStatements.taskRoot, { ...keys, id });
      return row ? (JSON.parse(String(row.view)) as Message) : null;
    },
  };
}

export function taskWriter(
  db: Db,
  dialect: Dialect,
  keys: BoardKeys,
  preloadedProof: (id: number) => Row | undefined,
): BoardTaskWriter {
  return {
    ...taskReads(db, dialect, keys),
    async nextReadyTask({ under, ...input }) {
      const statement =
        under === undefined ? taskReadStatements.nextReadyTask : taskReadStatements.nextReadySubtreeTask;
      const [row] = await query(db, dialect, statement, { ...keys, ...input, under: under ?? null });
      return row ? (JSON.parse(String(row.view)) as Message) : null;
    },
    async taskNeeds(ids) {
      if (ids.length === 0) return [];
      const rows = await query(db, dialect, taskReadStatements.taskNeeds, { ...keys, ids: JSON.stringify(ids) });
      return rows.map((row) => JSON.parse(String(row.view)) as Message);
    },
    async taskNeedEdges(ids) {
      const rows = await query(db, dialect, taskReadStatements.taskNeedEdges, { ...keys, ids: JSON.stringify(ids) });
      return rows.map((row) => ({
        needs: Number(row.needs),
        channel: String(row.channel),
        completed: row.state === "completed",
      }));
    },
    async taskDependants(id) {
      const preloaded = preloadedProof(id);
      if (preloaded && !preloaded.has_dependants) return { any: false, ready: [] };
      const rows = await query(db, dialect, taskReadStatements.taskDependants, { ...keys, id });
      return {
        any: rows.length > 0,
        ready: rows.flatMap((row) => (row.view == null ? [] : [JSON.parse(String(row.view)) as Message])),
      };
    },
    async taskClaimProof(id) {
      const row =
        preloadedProof(id) ?? (await query(db, dialect, taskReadStatements.taskClaimProof, { ...keys, id }))[0];
      return row?.claim_token == null || row.claim_until == null
        ? null
        : { hash: row.claim_token as Uint8Array, until: Number(row.claim_until) };
    },
  };
}
