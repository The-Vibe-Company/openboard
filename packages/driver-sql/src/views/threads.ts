import { BoardError, type Message } from "@openboard/contract";
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

function threadPage(order: "ASC" | "DESC") {
  const direction: Fragment = { fragment: () => order };
  return sql`WITH root AS (
      SELECT root.board_id, root.id, root.view,
        (CAST(${"after"} AS BIGINT) IS NULL OR EXISTS (
          SELECT 1 FROM messages AS anchor WHERE anchor.board_id = ${"boardId"} AND anchor.id = ${"after"}
            AND COALESCE(anchor.re, anchor.id) = root.id
        )) AS valid_after
      FROM messages AS target JOIN messages AS root ON root.board_id = target.board_id
        AND root.id = COALESCE(target.re, target.id)
      WHERE target.board_id = ${"boardId"} AND target.id = ${"id"}
    ), page AS (
      SELECT board_id, id, view FROM messages WHERE board_id = ${"boardId"}
        AND re = (SELECT id FROM root WHERE board_id = ${"boardId"} AND valid_after)
        AND id > COALESCE(CAST(${"after"} AS BIGINT), 0)
      ORDER BY id ${direction} LIMIT COALESCE(CAST(${"limit"} AS BIGINT), 9223372036854775807)
    )
    SELECT id, view, valid_after FROM root WHERE board_id = ${"boardId"}
    UNION ALL SELECT id, view, NULL FROM page WHERE board_id = ${"boardId"}
    ORDER BY id`;
}

/** A channel's threads by activity between two bounds: the latest of them (`DESC`), or the first (`ASC`). */
function threadList(order: "ASC" | "DESC") {
  const direction: Fragment = { fragment: () => order };
  return sql`WITH filters AS (SELECT CAST(${"labels"} AS TEXT) AS data),
    recent AS (
      SELECT root.board_id, root.id, root.active, root.view, root.replies, root.last_reply
      FROM messages AS root
      WHERE root.board_id = ${"boardId"} AND root.channel = ${"channel"} AND root.re IS NULL
        AND (root.active, root.id) < (CAST(${"beforeActive"} AS BIGINT), CAST(${"beforeRoot"} AS BIGINT))
        AND root.active > CAST(${"after"} AS BIGINT)
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
      ORDER BY root.active ${direction}, root.id ${direction} LIMIT CAST(${"limit"} AS BIGINT)
    )
    SELECT boards.head, recent.active, recent.id, recent.view, recent.replies, reply.view AS last_view
    FROM boards LEFT JOIN recent ON recent.board_id = boards.id
    LEFT JOIN messages AS reply ON reply.board_id = boards.id AND reply.id = recent.last_reply
    WHERE boards.id = ${"boardId"} AND boards.org_id = ${"orgId"}
    ORDER BY recent.active, recent.id`;
}

export const threadStatements = {
  listThreads: threadList("DESC"),
  listThreadsAfter: threadList("ASC"),
  thread: threadPage("DESC"),
  threadAfter: threadPage("ASC"),
};

/** The thread reads of one board's view: one statement reads the message and its replies together. */
export function threadReads(db: Db, dialect: Dialect, scope: BoardScope): Pick<BoardView, "thread" | "listThreads"> {
  return {
    async listThreads(channel, labels = [], { before, after, limit = 50 } = {}) {
      const statement = after === undefined ? threadStatements.listThreads : threadStatements.listThreadsAfter;
      const rows = await query(db, dialect, statement, {
        boardId: scope.boardId,
        orgId: scope.orgId,
        channel,
        labels: JSON.stringify(labels),
        // Past every log position, so the first page reads through the same index range as the older ones.
        beforeActive: before?.active ?? Number.MAX_SAFE_INTEGER,
        beforeRoot: before?.root ?? Number.MAX_SAFE_INTEGER,
        // Every thread is active at a position past zero, the lowest cursor.
        after: after ?? 0,
        // One row past the latest page says whether an older thread exists without a second read.
        limit: after === undefined ? limit + 1 : limit,
      });
      const head = Number(rows[0]?.head ?? 0);
      const listed = rows.filter((row) => row.view != null);
      const extra = after === undefined && listed.length > limit;
      const page = extra ? listed.slice(1) : listed;
      const oldest = page[0];
      const older = extra && oldest ? { active: Number(oldest.active), root: Number(oldest.id) } : null;
      const threads = page.map((row) => ({
        message: JSON.parse(String(row.view)) as Message,
        replies: Number(row.replies),
        last: row.last_view == null ? null : (JSON.parse(String(row.last_view)) as Message),
      }));
      return { threads, head, older };
    },
    async thread(id, { after, limit } = {}) {
      const statement = after === undefined ? threadStatements.thread : threadStatements.threadAfter;
      const [root, ...replies] = await query(db, dialect, statement, {
        boardId: scope.boardId,
        id,
        after: after ?? null,
        limit: limit ?? null,
      });
      if (!root) return null;
      if (!root.valid_after) throw new BoardError("invalid_request", "after: that ID isn't a message of this thread");
      return {
        message: JSON.parse(String(root.view)) as Message,
        replies: replies.map(({ view }) => JSON.parse(String(view)) as Message),
      };
    },
  };
}
