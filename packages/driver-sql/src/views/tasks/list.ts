import type { Message, Task } from "@openboard/contract";
import { effectiveTask } from "@openboard/core";
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

const filterRows: Fragment = {
  fragment: ({ name }) => (name === "sqlite" ? "json_each(filters.data)" : "jsonb_array_elements(filters.data::jsonb)"),
};
const rootLabels: Fragment = {
  fragment: ({ name }) => (name === "sqlite" ? "json_each(root.labels)" : "jsonb_each_text(root.labels::jsonb)"),
};
const filterValues: Fragment = {
  fragment: ({ name }) =>
    name === "sqlite" ? "json_each(filter.value -> 1)" : "jsonb_array_elements_text(filter.value -> 1)",
};
export const TASK_LABELS: Fragment = { fragment: () => "" };
export const matchesTaskLabels = sql`NOT EXISTS (
    SELECT 1 FROM (SELECT CAST(${"labels"} AS TEXT) AS data) AS filters CROSS JOIN ${filterRows} AS filter
    LEFT JOIN ${rootLabels} AS root_label ON root_label.key = filter.value ->> 0
    WHERE root.board_id = ${"boardId"} AND (root_label.key IS NULL OR (
      filter.value -> 1 IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM ${filterValues} AS allowed WHERE root.board_id = ${"boardId"} AND allowed.value = root_label.value
      )
    ))
  )`;

// Include stored claims in the index lookup whenever they can supply a requested effective state.
function bindStates(states: readonly string[]) {
  const requested = (state: Task["state"]) => (states.includes(state) ? state : null);
  const ready = requested("ready");
  const blocked = requested("blocked");
  const claimed = requested("claimed");
  return {
    waiting: requested("waiting"),
    ready,
    blocked,
    completed: requested("completed"),
    failed: requested("failed"),
    canceled: requested("canceled"),
    storedClaimed: claimed ?? (ready || blocked ? "claimed" : null),
    claimed,
  };
}

/** Where a task list names its channels; `splice` puts one of the predicates below in its place. */
const CHANNELS: Fragment = { fragment: () => "" };
const PREREQUISITE: Fragment = { fragment: () => "" };
// Keep the prerequisite predicate optional at statement construction so the reverse index can drive filtered lists.
const needsTask = sql`AND t.id IN (
  SELECT task FROM task_needs
  WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND needs = CAST(${"needs"} AS BIGINT)
)`;

/** A board's visible tasks, filtered by effective state, root labels and actors. */
function taskList(
  channels: Statement<"boardId" | "channel" | "under">,
  prerequisite: Statement<"orgId" | "boardId" | "needs"> = sql``,
  latest = false,
  seekState = false,
) {
  const selectOrder: Fragment = { fragment: () => (latest ? "root.active DESC, t.id DESC" : "t.id") };
  const resultOrder: Fragment = { fragment: () => (latest ? "page.active, page.id" : "page.id") };
  // SQLite otherwise favors the ID range over state on sparse latest lists.
  const joinRoot: Fragment = {
    fragment: ({ name }) => {
      if (name !== "sqlite" || !seekState) return "JOIN";
      const index = channels === oneChannel ? "tasks_ready" : "tasks_board_state";
      return `INDEXED BY ${index} CROSS JOIN`;
    },
  };
  const list = sql`WITH page AS (
      SELECT t.board_id, t.id, root.active
      FROM tasks AS t ${joinRoot} messages AS root ON root.board_id = t.board_id AND root.id = t.id
      WHERE t.board_id = ${"boardId"} AND ${CHANNELS} AND t.id > CAST(${"after"} AS BIGINT)
        ${PREREQUISITE}
        AND ${VISIBLE_TASK_ROOT}
        AND t.state IN (
          ${"waiting"}, ${"ready"}, ${"blocked"}, ${"completed"}, ${"failed"}, ${"canceled"}, ${"storedClaimed"}
        )
        AND (t.state <> 'claimed' OR (
          (t.claim_until IS NULL OR t.claim_until > CAST(${"now"} AS BIGINT)) AND CAST(${"claimed"} AS TEXT) IS NOT NULL
        ) OR (
          ${EXPIRED_TASK_CLAIM} AND (
            (t.blocked_reason IS NULL AND CAST(${"ready"} AS TEXT) IS NOT NULL)
            OR (t.blocked_reason IS NOT NULL AND CAST(${"blocked"} AS TEXT) IS NOT NULL)
          )
        ))
        AND (CAST(${"owner"} AS TEXT) IS NULL OR t.owner = ${"owner"} OR t.owner IN (
          SELECT principal FROM actors WHERE board_id = ${"boardId"} AND lower(handle) = ${"ownerHandle"} AND id = principal
        ))
        AND (CAST(${"assignee"} AS TEXT) IS NULL OR t.for_actor = ${"assignee"} OR t.for_actor IN (
          SELECT id FROM actors WHERE board_id = ${"boardId"} AND lower(handle) = ${"assigneeHandle"}
        ))
        AND (CAST(${"author"} AS TEXT) IS NULL OR root.actor = ${"author"} OR EXISTS (
          SELECT 1 FROM actors AS writer WHERE writer.board_id = ${"boardId"} AND lower(writer.handle) = ${"authorHandle"}
            AND (writer.id = root.actor OR (writer.kind = 'person' AND writer.id = root.principal))
        ))
        AND ${TASK_LABELS}
      ORDER BY ${selectOrder} LIMIT CAST(${"limit"} AS BIGINT)
    )
    SELECT boards.head, page.id, root.view, root.replies, reply.view AS last_view
    FROM boards LEFT JOIN page ON page.board_id = boards.id
    LEFT JOIN messages AS root ON root.board_id = boards.id AND root.id = page.id
    LEFT JOIN messages AS reply ON reply.board_id = boards.id AND reply.id = root.last_reply
    WHERE boards.id = ${"boardId"} AND boards.org_id = ${"orgId"}
    ORDER BY ${resultOrder}`;
  const filtered = splice(splice(list, VISIBLE_TASK_ROOT, visibleTaskRoot), EXPIRED_TASK_CLAIM, expiredTaskClaim);
  return splice(
    splice(splice(filtered, CHANNELS, channels), PREREQUISITE, prerequisite),
    TASK_LABELS,
    matchesTaskLabels,
  );
}

export const taskListStatements = {
  listTasks: taskList(oneChannel),
  listSubtreeTasks: taskList(subtreeChannels),
  listBoardTasks: taskList(everyChannel),
  listTasksNeeding: taskList(oneChannel, needsTask),
  listSubtreeTasksNeeding: taskList(subtreeChannels, needsTask),
  listBoardTasksNeeding: taskList(everyChannel, needsTask),
  listLatestTasks: taskList(oneChannel, undefined, true),
  listLatestSubtreeTasks: taskList(subtreeChannels, undefined, true),
  listLatestBoardTasks: taskList(everyChannel, undefined, true),
  listLatestTasksByState: taskList(oneChannel, undefined, true, true),
  listLatestSubtreeTasksByState: taskList(subtreeChannels, undefined, true, true),
  listLatestBoardTasksByState: taskList(everyChannel, undefined, true, true),
  listLatestTasksNeeding: taskList(oneChannel, needsTask, true),
  listLatestSubtreeTasksNeeding: taskList(subtreeChannels, needsTask, true),
  listLatestBoardTasksNeeding: taskList(everyChannel, needsTask, true),
};

const taskListsByScope = {
  board: [taskListStatements.listBoardTasks, taskListStatements.listBoardTasksNeeding],
  channel: [taskListStatements.listTasks, taskListStatements.listTasksNeeding],
  subtree: [taskListStatements.listSubtreeTasks, taskListStatements.listSubtreeTasksNeeding],
} as const;

const latestTaskListsByScope = {
  board: [taskListStatements.listLatestBoardTasks, taskListStatements.listLatestBoardTasksNeeding],
  channel: [taskListStatements.listLatestTasks, taskListStatements.listLatestTasksNeeding],
  subtree: [taskListStatements.listLatestSubtreeTasks, taskListStatements.listLatestSubtreeTasksNeeding],
} as const;

const latestTaskListsByState = {
  board: taskListStatements.listLatestBoardTasksByState,
  channel: taskListStatements.listLatestTasksByState,
  subtree: taskListStatements.listLatestSubtreeTasksByState,
} as const;

/** A board's task list: one statement reads the page, each root's latest reply and the board's head together. */
export function taskListReads(
  db: Db,
  dialect: Dialect,
  scope: BoardScope,
  clock: () => number,
): Pick<BoardTaskReads, "listTasks"> {
  return {
    async listTasks({
      channel,
      under,
      states,
      labels = [],
      by,
      owner,
      for: assignee,
      needs,
      after = 0,
      latest,
      limit,
    }) {
      const now = clock();
      const scopeName = taskChannelScope(channel, under);
      const lists = latest ? latestTaskListsByScope : taskListsByScope;
      // Let the planner choose for broad lists, ready tasks, and prerequisite lookups.
      const seekState = latest && needs === undefined && states.length === 1 && states[0] !== "ready";
      const statement = seekState ? latestTaskListsByState[scopeName] : lists[scopeName][needs === undefined ? 0 : 1];
      const rows = await query(db, dialect, statement, {
        boardId: scope.boardId,
        orgId: scope.orgId,
        channel: channel ?? null,
        under: under ?? null,
        ...bindStates(states),
        labels: JSON.stringify(labels),
        owner: owner ?? null,
        ownerHandle: owner?.toLowerCase() ?? null,
        assignee: assignee ?? null,
        assigneeHandle: assignee?.toLowerCase() ?? null,
        author: by ?? null,
        authorHandle: by?.toLowerCase() ?? null,
        needs: needs ?? null,
        after,
        limit,
        now,
      });
      const head = Number(rows[0]?.head ?? 0);
      const tasks = rows
        .filter((row) => row.view != null)
        .map((row) => ({
          message: effectiveTask(JSON.parse(String(row.view)) as Message, now),
          replies: Number(row.replies),
          last: row.last_view == null ? null : (JSON.parse(String(row.last_view)) as Message),
        }));
      return { tasks, head };
    },
  };
}
