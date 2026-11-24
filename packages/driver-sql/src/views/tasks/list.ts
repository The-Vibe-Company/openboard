import type { Message } from "@openboard/contract";
import type { BoardScope, BoardTaskReads } from "@openboard/ports";
import type { Db, Dialect } from "../../db.ts";
import { type Fragment, query, type Statement, sql } from "../../sql.ts";
import { splice } from "../threads.ts";

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
/** Case-sensitive substring position on both engines. */
const position: Fragment = { fragment: ({ name }) => (name === "sqlite" ? "instr" : "strpos") };

/** Where a task list names its channels; `splice` puts one of the predicates below in its place. */
const CHANNELS: Fragment = { fragment: () => "" };
const everyChannel = sql`t.board_id = ${"boardId"}`;
const oneChannel = sql`t.channel = ${"channel"}`;
const subtreeChannels = sql`(t.channel = ${"channel"} OR t.channel LIKE ${"under"} ESCAPE '\\')`;

/**
 * A board's tasks whose root stands, in their roots' order, after a position, through `tasks_ready` for a channel: states as
 * `,ready,claimed,`, labels on the root, and who wrote the root, owns the task or is assigned it, by ID or handle.
 */
function taskList(channels: Statement<"boardId" | "channel" | "under">) {
  const list = sql`WITH filters AS (SELECT CAST(${"labels"} AS TEXT) AS data),
    page AS (
      SELECT t.board_id, t.id, root.view, root.replies, root.last_reply
      FROM tasks AS t JOIN messages AS root ON root.board_id = t.board_id AND root.id = t.id
      WHERE t.board_id = ${"boardId"} AND ${CHANNELS} AND t.id > CAST(${"after"} AS BIGINT) AND root.deleted = 0
        AND ${position}(CAST(${"states"} AS TEXT), ',' || t.state || ',') > 0
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
        AND NOT EXISTS (
          SELECT 1 FROM filters CROSS JOIN ${filterRows} AS filter
          LEFT JOIN ${rootLabels} AS root_label ON root_label.key = filter.value ->> 0
          WHERE root.board_id = ${"boardId"} AND (root_label.key IS NULL OR (
            filter.value -> 1 IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM ${filterValues} AS allowed WHERE root.board_id = ${"boardId"} AND allowed.value = root_label.value
            )
          ))
        )
      ORDER BY t.id LIMIT CAST(${"limit"} AS BIGINT)
    )
    SELECT boards.head, page.id, page.view, page.replies, reply.view AS last_view
    FROM boards LEFT JOIN page ON page.board_id = boards.id
    LEFT JOIN messages AS reply ON reply.board_id = boards.id AND reply.id = page.last_reply
    WHERE boards.id = ${"boardId"} AND boards.org_id = ${"orgId"}
    ORDER BY page.id`;
  return splice(list, CHANNELS, channels);
}

export const taskListStatements = {
  listTasks: taskList(oneChannel),
  listSubtreeTasks: taskList(subtreeChannels),
  listBoardTasks: taskList(everyChannel),
};

/** A board's task list: one statement reads the page, each root's latest reply and the board's head together. */
export function taskListReads(db: Db, dialect: Dialect, scope: BoardScope): Pick<BoardTaskReads, "listTasks"> {
  return {
    async listTasks({ channel, under, states, labels = [], by, owner, for: assignee, after = 0, limit }) {
      const statement =
        channel === undefined
          ? taskListStatements.listBoardTasks
          : under === undefined
            ? taskListStatements.listTasks
            : taskListStatements.listSubtreeTasks;
      const rows = await query(db, dialect, statement, {
        boardId: scope.boardId,
        orgId: scope.orgId,
        channel: channel ?? null,
        under: under ?? null,
        states: `,${states.join(",")},`,
        labels: JSON.stringify(labels),
        owner: owner ?? null,
        ownerHandle: owner?.toLowerCase() ?? null,
        assignee: assignee ?? null,
        assigneeHandle: assignee?.toLowerCase() ?? null,
        author: by ?? null,
        authorHandle: by?.toLowerCase() ?? null,
        after,
        limit,
      });
      const head = Number(rows[0]?.head ?? 0);
      const tasks = rows
        .filter((row) => row.view != null)
        .map((row) => ({
          message: JSON.parse(String(row.view)) as Message,
          replies: Number(row.replies),
          last: row.last_view == null ? null : (JSON.parse(String(row.last_view)) as Message),
        }));
      return { tasks, head };
    },
  };
}
