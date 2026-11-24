import { type Fragment, sql } from "../../sql.ts";
import { codePointOrder } from "../channels.ts";

const jsonStrings: Fragment = {
  fragment: ({ name }) =>
    name === "sqlite" ? "json_each(input.data)" : "jsonb_array_elements_text(input.data::jsonb)",
};
const jsonRows: Fragment = {
  fragment: ({ name }) => (name === "sqlite" ? "json_each(input.data)" : "jsonb_array_elements(input.data::jsonb)"),
};
const contains: Fragment = { fragment: ({ name }) => (name === "sqlite" ? "instr" : "strpos") };
const messageReactions: Fragment = {
  fragment: ({ name }) => (name === "sqlite" ? "m.view -> 'reactions'" : "m.view::jsonb ->> 'reactions'"),
};

export const messageStatements = {
  insertEvent: sql`INSERT INTO events (org_id, board_id, id, type, at, thread, message, channel, actor, principal,
    visibility, payload) VALUES (${"orgId"}, ${"boardId"}, ${"id"}, ${"type"}, ${"at"}, ${"thread"}, ${"message"},
    ${"channel"}, ${"actor"}, ${"principal"}, ${"visibility"}, ${"payload"})`,
  insertMessage: sql`INSERT INTO messages (org_id, board_id, id, channel, re, reply_to, actor, principal, profile,
    client_id, text, text_lower, labels, no_sync, version, created_at, active, view) VALUES (${"orgId"}, ${"boardId"},
    ${"id"}, ${"channel"}, ${"re"}, ${"replyTo"}, ${"actor"}, ${"principal"}, ${"profile"}, ${"clientId"}, ${"text"},
    ${"textLower"},
    ${"labels"}, ${"noSync"}, ${"id"}, ${"at"}, ${"active"}, ${"view"})`,
  bumpRoot: sql`UPDATE messages SET replies = replies + 1, last_reply = ${"id"}, active = ${"id"}, version = ${"id"}
    WHERE board_id = ${"boardId"} AND id = ${"root"}`,
  upsertChannel: sql`INSERT INTO channels (org_id, board_id, path, created_at, last_index, messages, threads)
    VALUES (${"orgId"}, ${"boardId"}, ${"path"}, ${"at"}, ${"id"}, 1, ${"threads"}) ON CONFLICT (board_id, path)
    DO UPDATE SET last_index = excluded.last_index, messages = channels.messages + 1,
    threads = channels.threads + excluded.threads`,
  mentionActors: sql`WITH input AS (SELECT CAST(${"handles"} AS TEXT) AS data)
    SELECT id, handle, name FROM actors WHERE org_id = ${"orgId"} AND board_id = ${"boardId"}
    AND EXISTS (
      SELECT 1 FROM input CROSS JOIN ${jsonStrings} AS wanted WHERE actors.board_id = ${"boardId"} AND (
        lower(actors.handle) = wanted.value OR
        substr(lower(actors.handle), length(actors.handle) - length(wanted.value)) = '/' || wanted.value
      )
    )
    ORDER BY handle${codePointOrder}, id${codePointOrder}`,
  mentionEvidence: sql`WITH input AS (SELECT CAST(${"handles"} AS TEXT) AS data),
    evidence AS (
      SELECT a.id AS actor, m.channel, m.id, m.version, m.board_id,
        CASE WHEN m.actor = a.id OR ${contains}(${messageReactions}, '"' || a.id || '"') > 0
          THEN NULL ELSE m.text END AS reference
      FROM actors AS a JOIN messages AS m ON a.org_id = m.org_id AND a.board_id = m.board_id
      WHERE a.org_id = ${"orgId"} AND a.board_id = ${"boardId"}
        AND m.org_id = ${"orgId"} AND m.board_id = ${"boardId"} AND m.deleted = 0
        AND EXISTS (
          SELECT 1 FROM input CROSS JOIN ${jsonStrings} AS wanted WHERE a.board_id = ${"boardId"} AND (
            lower(a.handle) = wanted.value OR
            substr(lower(a.handle), length(a.handle) - length(wanted.value)) = '/' || wanted.value
          )
        )
        AND (m.actor = a.id OR ${contains}(m.text, '@[' || a.id || ']') > 0 OR
          ${contains}(${messageReactions}, '"' || a.id || '"') > 0)
    ), ranked AS (
      SELECT actor, channel, id, version, reference, board_id,
        ROW_NUMBER() OVER (PARTITION BY actor, channel, reference ORDER BY id DESC) AS recent
      FROM evidence WHERE board_id = ${"boardId"}
    )
    SELECT actor, channel, id, version, reference FROM ranked WHERE board_id = ${"boardId"} AND recent = 1`,
  unchangedMentionEvidence: sql`WITH input AS (SELECT CAST(${"proofs"} AS TEXT) AS data)
    SELECT proof.value ->> 0 AS actor FROM input CROSS JOIN ${jsonRows} AS proof
    JOIN messages AS m ON m.id = CAST(proof.value ->> 1 AS BIGINT)
    WHERE m.board_id = ${"boardId"} AND m.org_id = ${"orgId"}
      AND m.version = CAST(proof.value ->> 2 AS BIGINT)`,
  threadWriters: sql`SELECT DISTINCT actor FROM messages WHERE org_id = ${"orgId"} AND board_id = ${"boardId"}
    AND (id = ${"thread"} OR re = ${"thread"})`,
  replyTarget: sql`SELECT id, channel, COALESCE(re, id) AS thread FROM messages
    WHERE board_id = ${"boardId"} AND id = ${"id"}`,
  message: sql`SELECT view FROM messages WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}`,
  editMessage: sql`UPDATE messages SET text = ${"text"}, text_lower = ${"textLower"}, revision = ${"revision"},
    version = ${"version"}, view = ${"view"} WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}`,
  deleteMessage: sql`UPDATE messages SET deleted = 1, text = '', text_lower = '', labels = ${"labels"},
    revision = ${"revision"}, version = ${"version"}, view = ${"view"}
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}`,
  reactToMessage: sql`UPDATE messages SET version = ${"version"}, view = ${"view"}
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}`,
  labelMessage: sql`UPDATE messages SET labels = ${"labels"}, version = ${"version"}, view = ${"view"}
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}`,
  dropRootReply: sql`UPDATE messages SET replies = replies - 1,
    (last_reply, active) = (
      SELECT MAX(reply.id), COALESCE(MAX(reply.id), ${"root"}) FROM messages AS reply
      WHERE reply.org_id = ${"orgId"} AND reply.board_id = ${"boardId"} AND reply.re = ${"root"} AND reply.deleted = 0
    )
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"root"}`,
  newerReply: sql`SELECT id FROM messages WHERE board_id = ${"boardId"} AND re = ${"thread"} AND id > ${"after"}
    ORDER BY id LIMIT 1`,
  clientPost: sql`SELECT view FROM messages WHERE board_id = ${"boardId"} AND client_id = ${"clientId"}`,
  ownClientPost: sql`SELECT view FROM messages WHERE board_id = ${"boardId"} AND org_id = ${"orgId"}
    AND client_id = ${"clientId"} AND principal = ${"principal"} AND actor = ${"actor"}`,
  channelMessages: sql`SELECT view FROM messages WHERE board_id = ${"boardId"} AND channel = ${"channel"}
    ORDER BY id DESC LIMIT ${"limit"}`,
  // Bound the page with the channel index before joining it to the board head from the same snapshot.
  channelMessagesAfter: sql`WITH page AS (
    SELECT id, view FROM messages WHERE board_id = ${"boardId"} AND org_id = ${"orgId"} AND channel = ${"channel"}
      AND id > ${"after"} ORDER BY id LIMIT ${"limit"}
  )
    SELECT b.head, p.view FROM boards b LEFT JOIN page p ON p.id <= b.head
    WHERE b.id = ${"boardId"} AND b.org_id = ${"orgId"} ORDER BY p.id`,
};
