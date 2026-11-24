import type { Actor, Message } from "@openboard/contract";
import { type BoardEvent, type MessageDeleted, type MessagePosted, messages, parseId } from "@openboard/core";
import type { BoardGrantReads, BoardKeys, BoardScope, BoardView, BoardWriter, Broadcaster } from "@openboard/ports";
import type { Db, Dialect } from "../db.ts";
import { type Fragment, query, sql } from "../sql.ts";
import { foldActorSeen, lockBoardAs } from "./actors.ts";
import { findAgent, findAgentByClaimKey, foldAgentClaimed, foldAgentRefreshed } from "./agents.ts";
import { lockBoard, setHead } from "./boards.ts";
import { codePointOrder, findChannel, foldChannelCreated } from "./channels.ts";
import {
  connectionNamed,
  connectionQuota,
  findConnection,
  foldAgentRevoked,
  foldConnectionCreated,
  foldConnectionRevoked,
  foldConnectionRotated,
  nextGrant,
  profileHolder,
} from "./connections.ts";
import { activeGrant, foldGrantEvent, grantReads } from "./grants.ts";
import { orgReads } from "./orgs.ts";
import { foldTaskEvent } from "./tasks/task-folds.ts";
import { taskReads } from "./tasks/tasks.ts";

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

/**
 * The fold of `message.posted`: the message row with its precomputed view and its channel's row; a reply keeps its
 * root as `re` and the reply it answered as `reply_to`, and bumps its root's reply count, latest reply, activity and
 * version (docs/data-model.md "How folds are derived").
 */
async function foldMessagePosted(tx: Db, dialect: Dialect, keys: BoardKeys, event: MessagePosted): Promise<void> {
  const { payload } = event;
  const reply = payload.re !== null;
  await query(tx, dialect, messageStatements.insertMessage, {
    ...keys,
    id: event.id,
    channel: payload.channel,
    re: reply ? event.thread : null,
    replyTo: payload.replyTo === null ? null : parseId(payload.replyTo),
    active: reply ? null : event.id,
    actor: payload.by.actor,
    principal: payload.by.principal,
    profile: payload.by.profile,
    clientId: payload.clientId ?? null,
    text: payload.text,
    textLower: payload.text.toLowerCase(),
    labels: JSON.stringify(payload.labels),
    noSync: payload.noSync ? 1 : 0,
    at: event.at,
    view: JSON.stringify(messages.messageView(event)),
  });
  if (reply)
    await query(tx, dialect, messageStatements.bumpRoot, { boardId: keys.boardId, id: event.id, root: event.thread });
  await query(tx, dialect, messageStatements.upsertChannel, {
    ...keys,
    path: payload.channel,
    at: event.at,
    id: event.id,
    threads: reply ? 0 : 1,
  });
}

async function foldMessageDeleted(tx: Db, dialect: Dialect, keys: BoardKeys, event: MessageDeleted): Promise<void> {
  const { view } = event.payload;
  await query(tx, dialect, messageStatements.deleteMessage, {
    ...keys,
    id: event.message,
    labels: JSON.stringify(view.labels),
    revision: view.revision,
    version: view.version,
    view: JSON.stringify(view),
  });
  if (event.thread !== event.message) {
    await query(tx, dialect, messageStatements.dropRootReply, { ...keys, root: event.thread });
  }
}

/** Appends one event to the log and folds it, in the caller's transaction. */
async function appendEvent(tx: Db, dialect: Dialect, keys: BoardKeys, event: BoardEvent): Promise<void> {
  await query(tx, dialect, messageStatements.insertEvent, {
    ...keys,
    id: event.id,
    type: event.type,
    at: event.at,
    thread: event.thread,
    message: event.message,
    channel: event.channel,
    actor: event.actor,
    principal: event.principal,
    visibility: event.visibility,
    payload: JSON.stringify(event.payload),
  });
  if (event.type === "channel.created") await foldChannelCreated(tx, dialect, keys, event);
  else if (event.type === "ob.grant.created" || event.type === "ob.grant.revoked") {
    await foldGrantEvent(tx, dialect, keys, event);
  } else if (event.type === "ob.connection.created") await foldConnectionCreated(tx, dialect, keys, event);
  else if (event.type === "ob.connection.revoked") await foldConnectionRevoked(tx, dialect, keys, event);
  else if (event.type === "actor.seen") await foldActorSeen(tx, dialect, keys, event);
  else if (event.type === "ob.agent.claimed") await foldAgentClaimed(tx, dialect, keys, event);
  else if (event.type === "ob.agent.refreshed") await foldAgentRefreshed(tx, dialect, keys, event);
  else if (event.type === "ob.agent.revoked") await foldAgentRevoked(tx, dialect, keys, event);
  else if (event.type === "ob.connection.rotated") await foldConnectionRotated(tx, dialect, keys, event);
  else if (event.type === "message.edited") {
    const { text, view } = event.payload;
    await query(tx, dialect, messageStatements.editMessage, {
      ...keys,
      id: event.message,
      text,
      textLower: text.toLowerCase(),
      revision: view.revision,
      version: view.version,
      view: JSON.stringify(view),
    });
  } else if (event.type === "message.deleted") await foldMessageDeleted(tx, dialect, keys, event);
  else if (event.type === "reaction.added" || event.type === "reaction.removed") {
    const { view } = event.payload;
    await query(tx, dialect, messageStatements.reactToMessage, {
      ...keys,
      id: event.message,
      version: view.version,
      view: JSON.stringify(view),
    });
  } else if (event.type === "labels.changed") {
    const { view } = event.payload;
    await query(tx, dialect, messageStatements.labelMessage, {
      ...keys,
      id: event.message,
      labels: JSON.stringify(view.labels),
      version: view.version,
      view: JSON.stringify(view),
    });
  } else if (event.type === "message.posted") await foldMessagePosted(tx, dialect, keys, event);
  else await foldTaskEvent(tx, dialect, keys, event);
}

/** `committed` collects the appended events, which the broadcaster hands to live tails once the write commits. */
function writer(
  tx: Db,
  dialect: Dialect,
  keys: BoardKeys,
  start: number,
  actor: Actor | null,
  committed: BoardEvent[],
): BoardWriter {
  let head = start;
  return {
    ...taskReads(tx, dialect, keys),
    get head() {
      return head;
    },
    channel: (path) => findChannel(tx, dialect, keys, path),
    actor,
    async mentionActors(handles) {
      const rows = await query(tx, dialect, messageStatements.mentionActors, {
        ...keys,
        handles: JSON.stringify([...handles]),
      });
      return rows.map(({ id, handle, name }) => ({ id: String(id), handle: String(handle), name: String(name) }));
    },
    async unchangedMentionEvidence(proofs) {
      if (proofs.length === 0) return new Set<string>();
      const rows = await query(tx, dialect, messageStatements.unchangedMentionEvidence, {
        ...keys,
        proofs: JSON.stringify(proofs.map(({ actor, id, version }) => [actor, id, version])),
      });
      return new Set(rows.map(({ actor }) => String(actor)));
    },
    async threadWriters(thread) {
      const rows = await query(tx, dialect, messageStatements.threadWriters, { ...keys, thread });
      return new Set(rows.map(({ actor }) => String(actor)));
    },
    async replyTarget(id) {
      const [row] = await query(tx, dialect, messageStatements.replyTarget, { boardId: keys.boardId, id });
      if (!row) return null;
      return { id: Number(row.id), channel: String(row.channel), thread: Number(row.thread) };
    },
    async message(id) {
      const [row] = await query(tx, dialect, messageStatements.message, { ...keys, id });
      return row ? (JSON.parse(String(row.view)) as Message) : null;
    },
    async newerReply(thread, after) {
      const [row] = await query(tx, dialect, messageStatements.newerReply, { boardId: keys.boardId, thread, after });
      return row ? Number(row.id) : null;
    },
    async clientPost(clientId) {
      const [row] = await query(tx, dialect, messageStatements.clientPost, { boardId: keys.boardId, clientId });
      return row ? (JSON.parse(String(row.view)) as Message) : null;
    },
    nextGrant: () => nextGrant(tx, dialect, keys),
    activeGrant: (id) => activeGrant(tx, dialect, keys, id),
    async grantMember(personId) {
      const member = await orgReads(tx, dialect, keys).member(personId);
      if (!member) return null;
      return { role: member.role, grants: await grantReads(tx, dialect, keys).personGrants(personId) };
    },
    connectionNamed: (name) => connectionNamed(tx, dialect, keys, name),
    connectionQuota: () => connectionQuota(tx, dialect, keys),
    connection: (id) => findConnection(tx, dialect, keys, id),
    agent: (id) => findAgent(tx, dialect, keys, id),
    agentByClaimKey: (connection, key) => findAgentByClaimKey(tx, dialect, keys, connection, key),
    profileHolder: (connection, profile) => profileHolder(tx, dialect, keys, connection, profile),
    async append(events) {
      if (events.length === 0) return;
      for (const event of events) {
        if (event.id !== head + 1) throw new Error(`event ${event.id} does not follow the board's head ${head}`);
        await appendEvent(tx, dialect, keys, event);
        committed.push(event);
        head = event.id;
      }
      await setHead(tx, dialect, keys, head);
    },
  };
}

/** One board's view: every statement binds the scope's keys, and a view cannot name another tenant. */
export function boardView(
  db: Db,
  dialect: Dialect,
  scope: BoardScope,
  broadcaster: Broadcaster,
): Pick<
  BoardView,
  "write" | "channelMessages" | "ownClientPost" | "mentionEvidence" | "taskRoot" | keyof BoardGrantReads
> {
  const keys: BoardKeys = { orgId: scope.orgId, boardId: scope.boardId };
  return {
    ...taskReads(db, dialect, keys),
    ...grantReads(db, dialect, keys),
    async write(fn, as) {
      let release: (() => void) | undefined;
      try {
        const { result, page } = await db.transaction(async (tx) => {
          const { head, actor } =
            as === undefined
              ? { head: await lockBoard(tx, dialect, keys), actor: null }
              : await lockBoardAs(tx, dialect, keys, as);
          const events: BoardEvent[] = [];
          const boardWriter = writer(tx, dialect, keys, head, actor, events);
          const result = await fn(boardWriter);
          const page = boardWriter.head > head ? { after: head, head: boardWriter.head, events } : undefined;
          if (page !== undefined) release = broadcaster.prepareCommit?.(scope, page);
          return { result, page };
        });
        if (page !== undefined) broadcaster.publish(scope, page);
        return result;
      } finally {
        release?.();
      }
    },
    async mentionEvidence(handles) {
      const rows = await query(db, dialect, messageStatements.mentionEvidence, {
        ...keys,
        handles: JSON.stringify([...handles]),
      });
      return rows.map(({ actor, channel, id, version, reference }) => ({
        actor: String(actor),
        channel: String(channel),
        id: Number(id),
        version: Number(version),
        reference: typeof reference === "string" ? reference : null,
      }));
    },
    async ownClientPost(clientId, { actor, principal }) {
      if (clientId.includes("\0")) return null;
      const [row] = await query(db, dialect, messageStatements.ownClientPost, { ...keys, clientId, actor, principal });
      return row ? (JSON.parse(String(row.view)) as Message) : null;
    },
    async channelMessages({ channel, after, limit }) {
      const params = { boardId: keys.boardId, channel, limit };
      if (after !== undefined) {
        const rows = await query(db, dialect, messageStatements.channelMessagesAfter, {
          ...params,
          orgId: keys.orgId,
          after,
        });
        const first = rows[0];
        if (!first) throw new Error("the scoped board is missing");
        if (after > Number(first.head)) return null;
        return rows.filter((row) => row.view !== null).map((row) => JSON.parse(String(row.view)) as Message);
      }
      const rows = await query(db, dialect, messageStatements.channelMessages, params);
      return rows.map((row) => JSON.parse(String(row.view)) as Message).reverse();
    },
  };
}
