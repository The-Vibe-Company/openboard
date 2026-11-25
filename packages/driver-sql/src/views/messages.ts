import type { Message } from "@openboard/contract";
import { type BoardEvent, checkDailyEvents, dailyEventWindow } from "@openboard/core";
import type { BoardGrantReads, BoardKeys, BoardScope, BoardView, BoardWriter, Broadcaster } from "@openboard/ports";
import type { Db, Dialect } from "../db.ts";
import { query } from "../sql.ts";
import { lockBoardAs } from "./actors.ts";
import { findAgent, findAgentByClaimKey } from "./agents.ts";
import { attachmentReads } from "./attachments/index.ts";
import { boardIdentity, repairStoredBytes, setHead } from "./boards.ts";
import { findChannel } from "./channels.ts";
import { connectionNamed, connectionQuota, findConnection, nextGrant, profileHolder } from "./connections.ts";
import { activeGrant, grantReads, otherGrantIssuers } from "./grants.ts";
import { inboundWriter } from "./inbound/index.ts";
import { type JobWrites, jobWriter } from "./jobs/index.ts";
import { notifyUsageDay } from "./jobs/usage.ts";
import { appendEvent } from "./messages/fold.ts";
import { messageStatements } from "./messages/statements.ts";
import { messageStorage } from "./messages/storage.ts";
import { orgReads } from "./orgs.ts";
import { scheduleWriter } from "./schedules/index.ts";
import { notifyScheduleSend } from "./schedules/send.ts";
import { schemaWriter } from "./schemas/registry.ts";
import { notifyTaskExpiry } from "./tasks/task-folds.ts";
import { taskReads, taskWriter } from "./tasks/tasks.ts";
import { matchWatchers, watcherWriter } from "./watchers/index.ts";
import { deliveryWriter, matchWebhooks } from "./webhooks/deliveries.ts";
import { webhookWriter } from "./webhooks/webhooks.ts";

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
  enqueued: JobWrites["committed"],
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
        if (hasWebhooks) await matchWebhooks(tx, dialect, keys, jobs, event, now, enqueued);
        await appendEvent(tx, dialect, keys, event);
        if (dialect.name === "sqlite") notifyUsageDay(event.at, enqueued);
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
  enqueued: JobWrites["committed"],
): BoardWriter {
  const preloaded = (id: number) => (id === taskId && committed.length === 0 ? locked.row : undefined);
  const usage = messageStorage(tx, dialect, keys, locked.storage, preloaded);
  const events = eventWriter(tx, dialect, keys, locked, committed, usage, now, jobs, enqueued);
  return {
    ...attachmentReads(tx, dialect, keys),
    ...taskWriter(tx, dialect, keys, preloaded),
    ...jobs,
    ...watcherWriter(tx, dialect, keys),
    ...inboundWriter(tx, dialect, keys),
    ...webhookWriter(tx, dialect, keys),
    ...deliveryWriter(tx, dialect, keys, enqueued),
    ...schemaWriter(tx, dialect, keys),
    append: events.append,
    get head() {
      return events.head;
    },
    channel: (path) => findChannel(tx, dialect, keys, path),
    actor: locked.actor,
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
    ...scheduleWriter(tx, dialect, keys),
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

type MessageBoardView = Pick<
  BoardView,
  | "write"
  | "identity"
  | "channelMessages"
  | "ownClientPost"
  | "mentionEvidence"
  | "taskRoot"
  | "taskBatch"
  | keyof BoardGrantReads
>;

/** One board's view: every statement binds the scope's keys, and a view cannot name another tenant. */
export function boardView(
  db: Db,
  dialect: Dialect,
  scope: BoardScope,
  broadcaster: Broadcaster,
  jobs: JobWrites,
): MessageBoardView {
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
          const enqueuing: JobWrites["committed"] = (kind, dueAt) => {
            enqueued ??= new Map();
            enqueued.set(kind, Math.min(dueAt, enqueued.get(kind) ?? Infinity));
          };
          const queue = jobWriter(tx, dialect, keys, enqueuing);
          const boardWriter = writer(tx, dialect, keys, locked, events, queue, jobs.now(), taskId, enqueuing);
          const result = await fn(boardWriter);
          const page = boardWriter.head > head ? { after: head, head: boardWriter.head, events } : undefined;
          if (page !== undefined && storage.staleSiblings) await repairStoredBytes(tx, dialect, keys);
          if (page !== undefined) release = broadcaster.prepareCommit?.(scope, page);
          return { result, page };
        });
        if (enqueued) for (const [kind, dueAt] of enqueued) jobs.committed(kind, dueAt);
        notifyTaskExpiry(page?.events ?? [], jobs.committed);
        notifyScheduleSend(page?.events ?? [], jobs);
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
