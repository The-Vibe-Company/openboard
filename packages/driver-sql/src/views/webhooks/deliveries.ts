import type { Message } from "@openboard/contract";
import {
  type BoardEvent,
  base32,
  eventAuthors,
  eventMentions,
  isTailMessageEvent,
  matchesWebhookFilter,
  mentionFilter,
  messages,
  parseTail,
} from "@openboard/core";
import { type BoardJobWriter, type BoardKeys, type BoardWebhookWriter, WEBHOOK_DELIVERY_JOB } from "@openboard/ports";
import type { Db, Dialect } from "../../db.ts";
import { query, sql } from "../../sql.ts";
import { actorReads } from "../actors.ts";
import { messageEvent } from "../events.ts";
import { messageStatements } from "../messages/statements.ts";
import { webhookReads, webhookRecord } from "./webhooks.ts";

export const deliveryStatements = {
  addDelivery: sql`INSERT INTO webhook_deliveries
    (org_id, board_id, id, webhook, event, thread, state, next_at, created_at, root_view)
    VALUES (${"orgId"}, ${"boardId"}, ${"id"}, ${"webhook"}, ${"event"}, ${"thread"}, 'pending', ${"now"}, ${"now"}, ${"root"})`,
  addPing: sql`INSERT INTO webhook_deliveries
    (org_id, board_id, id, webhook, event, thread, type, state, attempt, next_at, created_at)
    SELECT ${"orgId"}, ${"boardId"}, ${"id"}, id, NULL, NULL, 'board.ping', 'sending', 1, ${"now"}, ${"now"}
    FROM webhooks
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"webhook"} AND secret_id = ${"secretId"}
    RETURNING id`,
  pingSecret: sql`SELECT ciphertext, key_version FROM webhook_secrets
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND webhook_id = ${"webhook"} AND id = ${"secretId"}`,
  beginDelivery: sql`UPDATE webhook_deliveries SET state = 'sending', attempt = attempt + 1, instance = ${"instance"}
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"} AND event IS NOT NULL AND state IN ('pending', 'sending')
    RETURNING attempt`,
  deliveryInput: sql`SELECT w.config, w.secret_id, w.owner_actor, w.owner, w.directory, s.ciphertext, s.key_version, d.root_view,
      d.attempt, e.id, e.type, e.at, e.thread, e.message, e.channel, e.actor, e.principal, e.payload
    FROM webhook_deliveries d
    JOIN webhooks w ON w.org_id = d.org_id AND w.board_id = d.board_id AND w.id = d.webhook AND w.enabled = 1
    JOIN events e ON e.org_id = d.org_id AND e.board_id = d.board_id AND e.id = d.event
    LEFT JOIN webhook_secrets s ON s.org_id = w.org_id AND s.board_id = w.board_id AND s.webhook_id = w.id AND s.id = w.secret_id
    WHERE d.org_id = ${"orgId"} AND d.board_id = ${"boardId"} AND d.id = ${"id"}`,
  skipDelivery: sql`UPDATE webhook_deliveries SET state = 'skipped', done_at = ${"now"}, instance = NULL
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"} AND state = 'sending'`,
  finishDelivery: sql`UPDATE webhook_deliveries
    SET state = ${"state"}, last_status = ${"status"}, last_error = ${"error"}, done_at = ${"now"}, instance = NULL
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"} AND state = 'sending' AND attempt = ${"attempt"}`,
};

export function deliveryWriter(
  db: Db,
  dialect: Dialect,
  keys: BoardKeys,
): Pick<BoardWebhookWriter, "beginWebhookPing" | "beginWebhookAttempt" | "finishWebhookAttempt"> {
  return {
    async beginWebhookPing(record, id, now) {
      const params = { ...keys, id, webhook: record.webhook.id, secretId: record.secretId, now };
      if (!(await query(db, dialect, deliveryStatements.addPing, params)).length) return null;
      const [row] = await query(db, dialect, deliveryStatements.pingSecret, params);
      return typeof row?.ciphertext === "string"
        ? { ciphertext: row.ciphertext, keyVersion: Number(row.key_version) }
        : null;
    },
    async beginWebhookAttempt(id, instance, now) {
      const params = { ...keys, id, instance, now };
      if (!(await query(db, dialect, deliveryStatements.beginDelivery, params)).length) return null;
      const [row] = await query(db, dialect, deliveryStatements.deliveryInput, params);
      if (!row) {
        await query(db, dialect, deliveryStatements.skipDelivery, params);
        return null;
      }
      const event = messageEvent(row);
      if (!isTailMessageEvent(event)) throw new Error("invalid webhook event");
      const record = webhookRecord(row);
      return {
        record,
        webhook: record.webhook,
        event,
        root: row.root_view === null ? null : (JSON.parse(String(row.root_view)) as Message),
        attempt: Number(row.attempt),
        secret:
          typeof row.ciphertext === "string"
            ? { ciphertext: row.ciphertext, keyVersion: Number(row.key_version) }
            : null,
      };
    },
    async finishWebhookAttempt(id, attempt, outcome) {
      await query(db, dialect, deliveryStatements.finishDelivery, { ...keys, id, attempt, ...outcome });
    },
  };
}

/** A subscription creates an outbox row and a dispatch job in the originating transaction. */
export async function matchWebhooks(
  db: Db,
  dialect: Dialect,
  keys: BoardKeys,
  jobs: BoardJobWriter,
  event: BoardEvent,
  now: number,
) {
  // Older replicas can lease delivery jobs before they know how to decode this event.
  if (event.type === "task.reopened" || !isTailMessageEvent(event)) return;
  const subscriptions = (await webhookReads(db, dialect, keys).webhooks()).filter(({ webhook }) => webhook.enabled);
  if (!subscriptions.length) return;
  const read = async (id: number) => {
    const [row] = await query(db, dialect, messageStatements.message, { ...keys, id });
    return typeof row?.view === "string" ? (JSON.parse(row.view) as Message) : undefined;
  };
  const previous = event.type === "message.posted" ? undefined : await read(event.message);
  const root =
    event.thread === event.message
      ? event.type === "message.posted"
        ? messages.messageView(event)
        : event.payload.view
      : await read(event.thread);
  const { findFilterActors } = actorReads(db, dialect, keys);
  for (const { webhook, ownerActor, directory } of subscriptions) {
    const filters = parseTail(webhook.filter.tail);
    const { author, mention } = filters;
    const actors =
      author === undefined && mention === undefined
        ? []
        : await findFilterActors(
            author,
            mention === undefined || !directory ? undefined : mentionFilter(mention, ownerActor, true),
          );
    const resolved = {
      ...filters,
      authors: author === undefined ? undefined : eventAuthors(author, ownerActor, actors),
      mentions: mention === undefined ? undefined : eventMentions(mention, ownerActor, directory ? actors : []),
    };
    if (
      !matchesWebhookFilter(
        webhook.filter,
        event,
        resolved,
        previous,
        event.thread === event.message ? undefined : root,
      )
    )
      continue;
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${webhook.id}:${event.id}`)),
    );
    const id = `dl_${base32(digest.subarray(0, 10))}`;
    await query(db, dialect, deliveryStatements.addDelivery, {
      ...keys,
      id,
      webhook: webhook.id,
      event: event.id,
      thread: event.thread,
      now,
      root: JSON.stringify(root ?? null),
    });
    await jobs.enqueue(WEBHOOK_DELIVERY_JOB, now, { id });
  }
}
