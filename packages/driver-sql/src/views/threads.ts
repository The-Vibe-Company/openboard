import { BoardError, type Message } from "@openboard/contract";
import type { BoardScope, BoardView } from "@openboard/ports";
import type { Db, Dialect } from "../db.ts";
import { type Fragment, query, type Statement, sql } from "../sql.ts";

const filterRows: Fragment = {
  fragment: ({ name }) => (name === "sqlite" ? "json_each(filters.data)" : "jsonb_array_elements(filters.data::jsonb)"),
};
const rootLabels: Fragment = {
  fragment: ({ name }) => (name === "sqlite" ? "json_each(root.labels)" : "jsonb_each_text(root.labels::jsonb)"),
};
const hitLabels: Fragment = {
  fragment: ({ name }) => (name === "sqlite" ? "json_each(hit.labels)" : "jsonb_each_text(hit.labels::jsonb)"),
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

/** Where a thread list names its channels; `splice` puts one of the predicates below in its place. */
const CHANNELS: Fragment = { fragment: () => "" };
const oneChannel = sql`root.channel = ${"channel"}`;
const subtreeChannels = sql`(root.channel = ${"channel"} OR root.channel LIKE ${"under"} ESCAPE '\\')`;

/** `outer` with `inner`'s text and parameters in place of the `marker` slot. */
function splice<K extends string>(outer: Statement<K>, marker: Fragment, inner: Statement<K>): Statement<K> {
  const at = outer.slots.indexOf(marker);
  const [first = "", ...rest] = inner.strings;
  const middle = [`${outer.strings[at]}${first}`, ...rest];
  middle.push(`${middle.pop()}${outer.strings[at + 1]}`);
  return Object.freeze({
    strings: [...outer.strings.slice(0, at), ...middle, ...outer.strings.slice(at + 2)],
    slots: [...outer.slots.slice(0, at), ...inner.slots, ...outer.slots.slice(at + 1)],
  });
}

/**
 * A channel's threads by activity between two bounds: the latest of them (`DESC`), or the first (`ASC`). A subtree's
 * add every channel `under` matches; they read by board activity, so one channel's keep its own index.
 */
function threadList(order: "ASC" | "DESC", subtree = false) {
  const direction: Fragment = { fragment: () => order };

  const list = sql`WITH filters AS (SELECT CAST(${"labels"} AS TEXT) AS data),
    exact_author AS (
      SELECT board_id, id, kind FROM actors WHERE board_id = ${"boardId"} AND id = CAST(${"authorQuery"} AS TEXT)
    ), authors AS (
      SELECT board_id, id, kind FROM exact_author WHERE board_id = ${"boardId"}
      UNION ALL
      SELECT board_id, id, kind FROM actors WHERE board_id = ${"boardId"} AND lower(handle) = CAST(${"authorHandle"} AS TEXT)
        AND NOT EXISTS (SELECT 1 FROM exact_author WHERE board_id = ${"boardId"})
    ), mentioned AS (
      SELECT CAST(${"boardId"} AS BIGINT) AS board_id, CAST(${"mentionId"} AS TEXT) AS id
      WHERE CAST(${"mentionId"} AS TEXT) IS NOT NULL
      UNION
      SELECT board_id, id FROM actors WHERE board_id = ${"boardId"} AND lower(handle) = CAST(${"mentionHandle"} AS TEXT)
    ), mention_patterns AS (
      SELECT board_id, replace(replace(replace(id, '\\', '\\\\'), '%', '\\%'), '_', '\\_') AS id
      FROM mentioned WHERE board_id = ${"boardId"}
    ),
    recent AS (
      SELECT root.board_id, root.id, root.active, root.view, root.replies, root.last_reply
      FROM messages AS root
      WHERE root.board_id = ${"boardId"} AND ${CHANNELS} AND root.re IS NULL
        AND (root.active, root.id) < (CAST(${"beforeActive"} AS BIGINT), CAST(${"beforeRoot"} AS BIGINT))
        AND root.active > CAST(${"after"} AS BIGINT)
        AND ((CAST(${"labels"} AS TEXT) = '[]' AND CAST(${"text"} AS TEXT) IS NULL
          AND CAST(${"authorQuery"} AS TEXT) IS NULL AND CAST(${"authorActor"} AS TEXT) IS NULL
          AND CAST(${"mentionId"} AS TEXT) IS NULL) OR EXISTS (
          SELECT 1 FROM messages AS hit
          WHERE hit.board_id = ${"boardId"} AND (
            hit.id = root.id OR (hit.re = root.id AND (
              hit.deleted = 0 OR CAST(${"authorQuery"} AS TEXT) IS NOT NULL OR CAST(${"authorActor"} AS TEXT) IS NOT NULL
            ))
          )
            AND (CAST(${"authorActor"} AS TEXT) IS NULL OR hit.actor = ${"authorActor"})
            AND (CAST(${"authorQuery"} AS TEXT) IS NULL OR EXISTS (
              SELECT 1 FROM authors WHERE authors.board_id = ${"boardId"}
                AND (authors.id = hit.actor OR (authors.kind = 'person' AND authors.id = hit.principal))
            ))
            AND (CAST(${"mentionId"} AS TEXT) IS NULL OR EXISTS (
              SELECT 1 FROM mention_patterns AS mention WHERE mention.board_id = ${"boardId"}
                AND (hit.text LIKE '%@[' || mention.id || ']%' ESCAPE '\\' OR hit.text LIKE '%@[' || mention.id || '+%' ESCAPE '\\')
            ))
            AND (CAST(${"text"} AS TEXT) IS NULL OR hit.text_lower LIKE CAST(${"text"} AS TEXT) ESCAPE '\\')
            AND NOT EXISTS (
              SELECT 1 FROM filters CROSS JOIN ${filterRows} AS filter
              LEFT JOIN ${rootLabels} AS root_label ON root_label.key = filter.value ->> 0
              LEFT JOIN ${hitLabels} AS hit_label ON hit_label.key = filter.value ->> 0
              WHERE hit.board_id = ${"boardId"} AND (
                (root_label.key IS NULL AND hit_label.key IS NULL) OR (
                  filter.value -> 1 IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM ${filterValues} AS allowed WHERE hit.board_id = ${"boardId"}
                      AND (allowed.value = root_label.value OR allowed.value = hit_label.value)
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
  return splice(list, CHANNELS, subtree ? subtreeChannels : oneChannel);
}

export const threadStatements = {
  listThreads: threadList("DESC"),
  listThreadsAfter: threadList("ASC"),
  listSubtreeThreads: threadList("DESC", true),
  listSubtreeThreadsAfter: threadList("ASC", true),
  thread: threadPage("DESC"),
  threadAfter: threadPage("ASC"),
};

/** The latest threads, then those after a cursor: of one channel, and of a subtree. */
const oneChannelLists = [threadStatements.listThreads, threadStatements.listThreadsAfter] as const;
const subtreeLists = [threadStatements.listSubtreeThreads, threadStatements.listSubtreeThreadsAfter] as const;

/** The thread reads of one board's view: one statement reads the message and its replies together. */
export function threadReads(db: Db, dialect: Dialect, scope: BoardScope): Pick<BoardView, "thread" | "listThreads"> {
  return {
    async listThreads(channel, labels = [], { author, before, after, limit = 50, mentions, text, under } = {}) {
      const statement = (under === undefined ? oneChannelLists : subtreeLists)[after === undefined ? 0 : 1];
      const authorQuery = author && "query" in author ? author.query : null;
      const rows = await query(db, dialect, statement, {
        authorQuery,
        authorHandle: authorQuery?.toLowerCase() ?? null,
        authorActor: author && "actor" in author ? author.actor : null,
        mentionId: mentions?.id ?? null,
        mentionHandle: mentions?.handle ?? null,
        boardId: scope.boardId,
        orgId: scope.orgId,
        channel,
        under: under ?? null,
        labels: JSON.stringify(labels),
        text: text ?? null,
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
