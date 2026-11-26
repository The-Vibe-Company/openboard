import { OPEN_TASK_STATES } from "@openboard/core";
import type { BoardScope, BoardTaskReads } from "@openboard/ports";
import type { Db, Dialect } from "../../db.ts";
import { type Fragment, query, type Statement, sql } from "../../sql.ts";
import { splice } from "../threads.ts";
import {
  everyChannel,
  EXPIRED_TASK_CLAIM,
  expiredTaskClaim,
  oneChannel,
  subtreeChannels,
  taskChannelScope,
  VISIBLE_TASK_ROOT,
  visibleTaskRoot,
} from "./filters.ts";

const CHANNELS: Fragment = { fragment: () => "" };

function taskCounts(channels: Statement<"boardId" | "channel" | "under">) {
  const counts = sql`SELECT CASE WHEN t.state = 'claimed' AND ${EXPIRED_TASK_CLAIM}
      THEN CASE WHEN t.blocked_reason IS NULL THEN 'ready' ELSE 'blocked' END
      ELSE t.state END AS effective_state, COUNT(*) AS total
    FROM tasks AS t
    JOIN boards ON boards.id = t.board_id
    JOIN messages AS root ON root.board_id = t.board_id AND root.id = t.id
    WHERE boards.id = ${"boardId"} AND boards.org_id = ${"orgId"}
      AND t.board_id = ${"boardId"} AND ${CHANNELS} AND ${VISIBLE_TASK_ROOT}
    GROUP BY effective_state`;
  const filtered = splice(splice(counts, VISIBLE_TASK_ROOT, visibleTaskRoot), EXPIRED_TASK_CLAIM, expiredTaskClaim);
  return splice(filtered, CHANNELS, channels);
}

export const taskCountStatements = {
  countBoardTasks: taskCounts(everyChannel),
  countChannelTasks: taskCounts(oneChannel),
  countSubtreeTasks: taskCounts(subtreeChannels),
};

const countByScope = {
  board: taskCountStatements.countBoardTasks,
  channel: taskCountStatements.countChannelTasks,
  subtree: taskCountStatements.countSubtreeTasks,
};

export function taskCountReads(
  db: Db,
  dialect: Dialect,
  scope: BoardScope,
  clock: () => number,
): Pick<BoardTaskReads, "countTasks"> {
  return {
    async countTasks({ channel, under }) {
      const rows = await query(db, dialect, countByScope[taskChannelScope(channel, under)], {
        boardId: scope.boardId,
        orgId: scope.orgId,
        channel: channel ?? null,
        under: under ?? null,
        now: clock(),
      });
      const totals = new Map(rows.map((row) => [row.effective_state, Number(row.total)]));
      return {
        open: OPEN_TASK_STATES.reduce((total, state) => total + (totals.get(state) ?? 0), 0),
        waiting: totals.get("waiting") ?? 0,
        ready: totals.get("ready") ?? 0,
        claimed: totals.get("claimed") ?? 0,
        blocked: totals.get("blocked") ?? 0,
        completed: totals.get("completed") ?? 0,
        failed: totals.get("failed") ?? 0,
        canceled: totals.get("canceled") ?? 0,
        all: rows.reduce((total, row) => total + Number(row.total), 0),
      };
    },
  };
}
