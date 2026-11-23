import type { Message } from "@openboard/contract";
import type { BoardScope, BoardView } from "@openboard/ports";
import type { Db, Dialect } from "../db.ts";
import { type Fragment, query, sql } from "../sql.ts";

const filterRows: Fragment = {
  fragment: ({ name }) => (name === "sqlite" ? "json_each(filters.data)" : "jsonb_array_elements(filters.data::jsonb)"),
};
const rootLabels: Fragment = {
  fragment: ({ name }) => (name === "sqlite" ? "json_each(root.labels)" : "jsonb_each_text(root.labels::jsonb)"),
};
const replyLabels: Fragment = {
  fragment: ({ name }) => (name === "sqlite" ? "json_each(reply.labels)" : "jsonb_each_text(reply.labels::jsonb)"),
};
const filterValues: Fragment = {
  fragment: ({ name }) =>
    name === "sqlite" ? "json_each(filter.value -> 1)" : "jsonb_array_elements_text(filter.value -> 1)",
};

export const threadStatements = {
  listThreads: sql`WITH filters AS (SELECT CAST(${"labels"} AS TEXT) AS data),
    recent AS (
      SELECT root.board_id, root.id, root.active, root.view, root.replies, root.last_reply
      FROM messages AS root
      WHERE root.board_id = ${"boardId"} AND root.channel = ${"channel"} AND root.re IS NULL
        AND (CAST(${"labels"} AS TEXT) = '[]' OR EXISTS (
          SELECT 1 FROM (SELECT 1) AS thread
          LEFT JOIN messages AS reply ON reply.board_id = root.board_id AND reply.re = root.id AND reply.deleted = 0
          WHERE root.board_id = ${"boardId"} AND NOT EXISTS (
            SELECT 1 FROM filters CROSS JOIN ${filterRows} AS filter
            LEFT JOIN ${rootLabels} AS root_label ON root_label.key = filter.value ->> 0
            LEFT JOIN ${replyLabels} AS reply_label ON reply_label.key = filter.value ->> 0
            WHERE root.board_id = ${"boardId"} AND (
              (root_label.key IS NULL AND reply_label.key IS NULL) OR (
                filter.value -> 1 IS NOT NULL AND NOT EXISTS (
                  SELECT 1 FROM ${filterValues} AS allowed WHERE root.board_id = ${"boardId"}
                    AND (allowed.value = root_label.value OR allowed.value = reply_label.value)
                )
              )
            )
          )
        ))
      ORDER BY root.active DESC, root.id DESC LIMIT 50
    )
    SELECT boards.head, recent.view, recent.replies, reply.view AS last_view
    FROM boards LEFT JOIN recent ON recent.board_id = boards.id
    LEFT JOIN messages AS reply ON reply.board_id = boards.id AND reply.id = recent.last_reply
    WHERE boards.id = ${"boardId"} AND boards.org_id = ${"orgId"}
    ORDER BY recent.active, recent.id`,
  thread: sql`SELECT id, view FROM messages WHERE board_id = ${"boardId"} AND (id = ${"id"} OR re = ${"id"})
    ORDER BY id`,
};

/** The thread reads of one board's view: one statement reads the message and its replies together. */
export function threadReads(db: Db, dialect: Dialect, scope: BoardScope): Pick<BoardView, "thread" | "listThreads"> {
  return {
    async listThreads(channel, labels = []) {
      const rows = await query(db, dialect, threadStatements.listThreads, {
        boardId: scope.boardId,
        orgId: scope.orgId,
        channel,
        labels: JSON.stringify(labels),
      });
      const threads = rows.flatMap((row) =>
        row.view == null
          ? []
          : [
              {
                message: JSON.parse(String(row.view)) as Message,
                replies: Number(row.replies),
                last: row.last_view == null ? null : (JSON.parse(String(row.last_view)) as Message),
              },
            ],
      );
      return { threads, head: Number(rows[0]?.head ?? 0) };
    },
    async thread(id) {
      const rows = await query(db, dialect, threadStatements.thread, { boardId: scope.boardId, id });
      const [first, ...rest] = rows.map((row) => ({
        id: Number(row.id),
        view: JSON.parse(String(row.view)) as Message,
      }));
      if (first?.id !== id) return null;
      return { message: first.view, replies: rest.map(({ view }) => view) };
    },
  };
}
