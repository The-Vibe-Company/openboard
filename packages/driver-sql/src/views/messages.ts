import type { Message } from "@openboard/contract";
import {
  type BoardEvent,
  checkDailyEvents,
  dailyEventWindow,
  type MessageDeleted,
  type MessagePosted,
  messages,
  parseId,
} from "@openboard/core";
import type { BoardGrantReads, BoardKeys, BoardScope, BoardView, BoardWriter, Broadcaster } from "@openboard/ports";
import type { Db, Dialect } from "../db.ts";
import { query } from "../sql.ts";
import { foldActorSeen, lockBoardAs } from "./actors.ts";
import { findAgent, findAgentByClaimKey, foldAgentClaimed, foldAgentRefreshed } from "./agents.ts";
import { boardIdentity, repairStoredBytes, setHead } from "./boards.ts";
import { findChannel, foldChannelCreated } from "./channels.ts";
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
import { activeGrant, foldGrantEvent, grantReads, otherGrantIssuers } from "./grants.ts";
import { foldInbound, inboundWriter } from "./inbound/index.ts";
import { type JobWrites, jobWriter } from "./jobs/index.ts";
import { messageStatements } from "./messages/statements.ts";
import { messageStorage } from "./messages/storage.ts";
import { orgReads } from "./orgs.ts";
import { foldSchemaRegistered, schemaWriter } from "./schemas/registry.ts";
import { foldTaskEvent, notifyTaskExpiry } from "./tasks/task-folds.ts";
import { taskReads, taskWriter } from "./tasks/tasks.ts";
import { foldWatchersRegistered, matchWatchers, watcherWriter } from "./watchers/index.ts";
import { deliveryWriter, matchWebhooks } from "./webhooks/deliveries.ts";
import { foldWebhook, webhookWriter } from "./webhooks/webhooks.ts";

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
  else if (
    event.type === "ob.grant.created" ||
    event.type === "ob.grant.revoked" ||
    event.type === "ob.grant.updated"
  ) {
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
  else if (event.type === "ob.schema.registered") await foldSchemaRegistered(tx, dialect, keys, event);
  else if (event.type === "ob.watchers.registered") await foldWatchersRegistered(tx, dialect, keys, event);
  else if (
    event.type === "ob.webhook.created" ||
    event.type === "ob.webhook.deleted" ||
    event.type === "ob.webhook.updated" ||
    event.type === "ob.webhook.disabled"
  )
    await foldWebhook(tx, dialect, keys, event);
  else if (
    event.type === "ob.inbound.created" ||
    event.type === "ob.inbound.updated" ||
    event.type === "ob.inbound.deleted"
  )
    await foldInbound(tx, dialect, keys, event);
  else if (event.type !== "watch.failed") await foldTaskEvent(tx, dialect, keys, event);
}

/** `committed` collects the appended events, which the broadcaster hands to live tails once the write commits. */
function eventWriter(
  tx: Db,
  dialect: Dialect,
  keys: BoardKeys,
  locked: Awaited<ReturnType<typeof lockBoardAs>>,
  committed: BoardEvent[],
  usage: ReturnType<typeof messageStorage>,
  measured: number,
  jobs: ReturnType<typeof jobWriter>,
): Pick<BoardWriter, "append" | "head"> {
  let { head, hasWatchers, hasWebhooks } = locked;
  const { dailyEvents } = locked;
  let { day, count } = dailyEvents;
  return {
    get head() {
      return head;
    },
    async append(events) {
      const [first] = events;
      if (!first) return;
      const now = Number.isFinite(measured) ? measured : first.at;
      const window = dailyEventWindow(now);
      // A queued write with an earlier clock reading cannot reopen a prior day.
      if (window.day > day) {
        day = window.day;
        count = 0;
      }
      const counted = events.filter(({ type }) => type !== "ob.webhook.disabled").length;
      if (counted) checkDailyEvents(count, counted, dailyEvents.limit, dailyEventWindow(day).nextDay, now);
      for (const event of events) {
        if (event.id !== head + 1) throw new Error(`event ${event.id} does not follow the board's head ${head}`);
        await usage.account(event);
        if (hasWatchers) await matchWatchers(tx, dialect, keys, event);
        if (hasWebhooks) await matchWebhooks(tx, dialect, keys, jobs, event, now);
        await appendEvent(tx, dialect, keys, event);
        if (
          (event.type === "ob.webhook.created" || event.type === "ob.webhook.updated") &&
          event.payload.webhook.enabled
        )
          hasWebhooks = true;
        if (event.type === "ob.watchers.registered") hasWatchers = true;
        committed.push(event);
        head = event.id;
      }
      count += counted;
      await setHead(tx, dialect, keys, head, usage.boardBytes, { day, count });
    },
  };
}

function writer(
  tx: Db,
  dialect: Dialect,
  keys: BoardKeys,
  locked: Awaited<ReturnType<typeof lockBoardAs>>,
  committed: BoardEvent[],
  jobs: ReturnType<typeof jobWriter>,
  now: number,
  taskId: number | null,
): BoardWriter {
  const { actor, storage } = locked;
  // Once a callback appends events, later reads must see its folds.
  const preloaded = (id: number) => (id === taskId && committed.length === 0 ? locked.row : undefined);
  const usage = messageStorage(tx, dialect, keys, storage, preloaded);
  const events = eventWriter(tx, dialect, keys, locked, committed, usage, now, jobs);
  return {
    ...taskWriter(tx, dialect, keys, preloaded),
    ...jobs,
    ...watcherWriter(tx, dialect, keys),
    ...inboundWriter(tx, dialect, keys),
    ...webhookWriter(tx, dialect, keys),
    ...deliveryWriter(tx, dialect, keys),
    ...schemaWriter(tx, dialect, keys),
    append: events.append,
    get head() {
      return events.head;
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
    message: usage.readMessage,
    async newerReply(thread, after) {
      const [row] = await query(tx, dialect, messageStatements.newerReply, { boardId: keys.boardId, thread, after });
      return row ? Number(row.id) : null;
    },
    async clientPost(clientId) {
      const [row] = await query(tx, dialect, messageStatements.clientPost, { boardId: keys.boardId, clientId });
      return row ? (JSON.parse(String(row.view)) as Message) : null;
    },
    listGrants: grantReads(tx, dialect, keys).listGrants,
    otherGrantIssuers: (replacing) => otherGrantIssuers(tx, dialect, keys, replacing),
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
  };
}

/** One board's view: every statement binds the scope's keys, and a view cannot name another tenant. */
export function boardView(
  db: Db,
  dialect: Dialect,
  scope: BoardScope,
  broadcaster: Broadcaster,
  jobs: JobWrites,
): Pick<
  BoardView,
  "write" | "identity" | "channelMessages" | "ownClientPost" | "mentionEvidence" | "taskRoot" | keyof BoardGrantReads
> {
  const keys: BoardKeys = { orgId: scope.orgId, boardId: scope.boardId };
  return {
    ...taskReads(db, dialect, keys),
    ...grantReads(db, dialect, keys),
    identity: () => boardIdentity(db, dialect, keys),
    async write(fn, as, taskId = null) {
      let release: (() => void) | undefined;
      let enqueued: Map<string, number> | undefined;
      try {
        const { result, page } = await db.transaction(async (tx) => {
          const now = jobs.now();
          const window = dailyEventWindow(Number.isFinite(now) ? now : 0);
          const locked = await lockBoardAs(tx, dialect, keys, as ?? null, window, taskId);
          const { head, storage } = locked;
          const events: BoardEvent[] = [];
          const queue = jobWriter(tx, dialect, keys, (kind, dueAt) => {
            enqueued ??= new Map();
            enqueued.set(kind, Math.min(dueAt, enqueued.get(kind) ?? Infinity));
          });
          const boardWriter = writer(tx, dialect, keys, locked, events, queue, now, taskId);
          const result = await fn(boardWriter);
          const page = boardWriter.head > head ? { after: head, head: boardWriter.head, events } : undefined;
          if (page !== undefined && storage.staleSiblings) await repairStoredBytes(tx, dialect, keys);
          if (page !== undefined) release = broadcaster.prepareCommit?.(scope, page);
          return { result, page };
        });
        if (enqueued) for (const [kind, dueAt] of enqueued) jobs.committed(kind, dueAt);
        notifyTaskExpiry(page?.events ?? [], jobs.committed);
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
