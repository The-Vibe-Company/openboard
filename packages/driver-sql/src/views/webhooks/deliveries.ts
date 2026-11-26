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
  webhookMaxAttempts,
} from "@openboard/core";
import { type BoardKeys, type BoardWebhookWriter, WEBHOOK_DELIVERY_JOB } from "@openboard/ports";
import type { Db, Dialect } from "../../db.ts";
import { type Fragment, query, sql } from "../../sql.ts";
import { messageEvent } from "../events.ts";
import type { JobWrites } from "../jobs/index.ts";
import { notifyUsageDay } from "../jobs/usage.ts";
import type { AutomationEvent } from "../messages.ts";
import { webhookReads, webhookRecord, webhookStatements } from "./webhooks.ts";

// Event positions establish order even if the clock stalls or moves backwards.
// Keep the normal thread equality indexable. The separate null lane also
// handles jobs with no board event position, ordered by creation time and ID.
const earlierThreaded: Fragment = {
  fragment: () => "prior.thread = d.thread AND prior.event < d.event",
};
const earlierThreadless: Fragment = {
  fragment: () => "prior.thread IS NULL AND prior.event < d.event",
};
const earlierPing: Fragment = {
  fragment: () => `prior.thread IS NULL AND prior.event IS NULL
    AND (prior.created_at, prior.id) < (d.created_at, d.id)
    AND (prior.state = 'pending' OR prior.instance IS NOT NULL)`,
};
const unfinishedDelivery: Fragment = {
  fragment: () => "prior.webhook = d.webhook AND prior.state IN ('pending', 'sending')",
};
export const earlierDelivery: Fragment = {
  fragment: (dialect) => {
    // Keep the tenant checks on event probes as filters on Postgres so cold
    // estimates cannot turn them into scans of the tenant's webhook history.
    // Pings use the history index's creation order.
    const eventTenant = dialect.name === "postgres" ? "IS NOT DISTINCT FROM" : "=";
    const exists = (lane: Fragment, order: string, tenant = eventTenant) => `(SELECT 1 FROM webhook_deliveries prior
      WHERE prior.org_id ${tenant} d.org_id AND prior.board_id ${tenant} d.board_id
        AND ${unfinishedDelivery.fragment(dialect)}
        AND ${lane.fragment(dialect)}
      ORDER BY ${order} LIMIT 1) IS NOT NULL`;
    return `(CASE WHEN d.thread IS NOT NULL THEN ${exists(earlierThreaded, "prior.event DESC")}
      WHEN d.event IS NOT NULL THEN ${exists(earlierThreadless, "prior.event DESC")}
      ELSE ${exists(earlierPing, "prior.created_at DESC, prior.id DESC", "=")} END)`;
  },
};

const deliveryRows: Fragment = {
  fragment: ({ name }) =>
    name === "postgres"
      ? "jsonb_array_elements(input.data::jsonb) WITH ORDINALITY AS batch(value, key)"
      : "json_each(input.data) AS batch",
};

export const deliveryStatements = {
  addDeliveries: sql`WITH input AS (SELECT CAST(${"rows"} AS TEXT) AS data)
    INSERT INTO webhook_deliveries
      (org_id, board_id, id, webhook, event, thread, state, next_at, created_at, root_view)
    SELECT ${"orgId"}, ${"boardId"}, value ->> 0, value ->> 1, ${"event"}, ${"thread"}, 'pending', ${"now"}, ${"now"}, ${"root"}
    FROM boards CROSS JOIN input CROSS JOIN ${deliveryRows}
    WHERE boards.org_id = ${"orgId"} AND boards.id = ${"boardId"}`,
  addDeliveryJobs: sql`WITH input AS (SELECT CAST(${"rows"} AS TEXT) AS data)
    INSERT INTO jobs (org_id, board_id, kind, available_at, payload)
    SELECT ${"orgId"}, ${"boardId"}, ${"kind"}, ${"now"}, value ->> 2
    FROM boards CROSS JOIN input CROSS JOIN ${deliveryRows}
    WHERE boards.org_id = ${"orgId"} AND boards.id = ${"boardId"} ORDER BY batch.key`,
  addPing: sql`INSERT INTO webhook_deliveries
    (org_id, board_id, id, webhook, event, thread, type, state, attempt, next_at, created_at)
    SELECT ${"orgId"}, ${"boardId"}, ${"id"}, id, NULL, NULL, 'board.ping', 'sending', 1, ${"now"}, ${"now"}
    FROM webhooks
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"webhook"} AND secret_id = ${"secretId"}
    RETURNING id`,
  retryDelivery: sql`UPDATE webhook_deliveries
    SET state = 'pending', attempt = 0, next_at = ${"now"}, last_status = NULL,
        last_error = NULL, done_at = NULL, instance = NULL
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND webhook = ${"webhook"} AND id = ${"id"}
      AND state = 'dead'
    RETURNING id`,
  findDelivery: sql`SELECT id FROM webhook_deliveries
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND webhook = ${"webhook"} AND id = ${"id"}`,
  // Under the board lock, recheck the lane and reserve capacity across instances.
  // A manual resend can reopen an older row while a later attempt is on the wire.
  beginDelivery: sql`WITH candidate AS MATERIALIZED (
    SELECT d.id, d.org_id, (NOT EXISTS (
      SELECT 1 FROM webhooks w
      WHERE w.org_id = ${"orgId"} AND w.board_id = ${"boardId"} AND w.id = d.webhook
    ) OR (
      NOT (CASE WHEN d.thread IS NOT NULL THEN EXISTS (
        SELECT 1 FROM webhook_deliveries prior
        WHERE prior.org_id = ${"orgId"} AND prior.board_id = ${"boardId"} AND ${unfinishedDelivery}
          AND ${earlierThreaded}
      ) WHEN d.event IS NOT NULL THEN EXISTS (
        SELECT 1 FROM webhook_deliveries prior
        WHERE prior.org_id = ${"orgId"} AND prior.board_id = ${"boardId"} AND ${unfinishedDelivery}
          AND ${earlierThreadless}
      ) ELSE EXISTS (
        SELECT 1 FROM webhook_deliveries prior
        WHERE prior.org_id = ${"orgId"} AND prior.board_id = ${"boardId"} AND ${unfinishedDelivery}
          AND ${earlierPing}
      ) END)
      AND (
        SELECT COUNT(*) < 4 AND COUNT(CASE WHEN prior.thread IS NOT DISTINCT FROM d.thread THEN 1 END) = 0
        FROM webhook_deliveries prior
        WHERE prior.org_id = ${"orgId"} AND prior.board_id = ${"boardId"} AND prior.webhook = d.webhook
          AND prior.id <> d.id AND prior.state = 'sending' AND prior.lease_until > ${"now"}
      )
    )) AS ready
    FROM webhook_deliveries d
    WHERE d.org_id = ${"orgId"} AND d.board_id = ${"boardId"} AND d.id = ${"id"}
      AND d.state IN ('pending', 'sending') AND d.next_at <= ${"now"}
      AND d.attempt < CASE WHEN d.event IS NULL THEN 1 ELSE ${"maxAttempts"} END
      AND NOT EXISTS (
        SELECT 1 FROM webhooks w WHERE w.org_id = ${"orgId"} AND w.board_id = ${"boardId"}
          AND w.id = d.webhook AND w.enabled = 0
      )
  )
    UPDATE webhook_deliveries AS d
    SET state = CASE WHEN candidate.ready THEN 'sending' ELSE d.state END,
        attempt = d.attempt + CASE WHEN candidate.ready THEN 1 ELSE 0 END,
        instance = CASE WHEN candidate.ready THEN ${"instance"} ELSE d.instance END,
        lease_until = CASE WHEN candidate.ready THEN ${"leaseUntil"} ELSE d.lease_until END
    FROM candidate
    WHERE d.org_id = ${"orgId"} AND d.board_id = ${"boardId"} AND d.id = candidate.id
    RETURNING (SELECT ready FROM candidate WHERE id = ${"id"} AND org_id = ${"orgId"}) AS ready`,
  expireFinalDelivery: sql`UPDATE webhook_deliveries
    SET state = 'dead', last_status = NULL, last_error = 'unreachable', done_at = ${"now"}, instance = NULL
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"}
      AND state = 'sending' AND next_at <= ${"now"} AND attempt >= CASE WHEN event IS NULL THEN 1 ELSE ${"maxAttempts"} END
      AND NOT EXISTS (
        SELECT 1 FROM webhooks w WHERE w.org_id = ${"orgId"} AND w.board_id = ${"boardId"}
          AND w.id = webhook_deliveries.webhook AND w.enabled = 0
      )
    RETURNING webhook, event`,
  recentDeadDeliveries: sql`SELECT COUNT(*) AS total FROM webhook_deliveries
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND webhook = ${"webhook"}
      AND state = 'dead' AND event IS NOT NULL AND done_at > ${"cutoff"}`,
  deliveryInput: sql`SELECT w.config, w.secret_id, w.owner_actor, w.owner, w.directory, w.workload, s.ciphertext, s.key_version, d.root_view,
      d.attempt, d.event, e.id, e.type, e.at, e.thread, e.message, e.channel, e.actor, e.principal, e.payload
    FROM webhook_deliveries d
    JOIN webhooks w ON w.org_id = d.org_id AND w.board_id = d.board_id AND w.id = d.webhook AND w.enabled = 1
    LEFT JOIN events e ON e.org_id = d.org_id AND e.board_id = d.board_id AND e.id = d.event
    LEFT JOIN webhook_secrets s ON s.org_id = w.org_id AND s.board_id = w.board_id AND s.webhook_id = w.id AND s.id = w.secret_id
    WHERE d.org_id = ${"orgId"} AND d.board_id = ${"boardId"} AND d.id = ${"id"}
      AND (d.event IS NULL OR e.id IS NOT NULL)`,
  skipDelivery: sql`UPDATE webhook_deliveries SET state = 'skipped', done_at = ${"now"}, instance = NULL
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"} AND state = 'sending' RETURNING id`,
  finishDelivery: sql`UPDATE webhook_deliveries
    SET state = ${"state"}, last_status = ${"status"}, last_error = ${"error"}, done_at = ${"doneAt"},
        next_at = COALESCE(${"nextAt"}, next_at), instance = NULL
    WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"id"} AND state = 'sending' AND attempt = ${"attempt"}
      AND (CAST(${"revokedJobId"} AS BIGINT) IS NULL OR (
        instance = ${"instance"} AND NOT EXISTS (
          SELECT 1 FROM jobs WHERE org_id = ${"orgId"} AND board_id = ${"boardId"} AND id = ${"revokedJobId"}
        )
      ))
    RETURNING id`,
};

export function deliveryWriter(
  db: Db,
  dialect: Dialect,
  keys: BoardKeys,
  enqueued: JobWrites["committed"],
): Pick<
  BoardWebhookWriter,
  | "beginWebhookPing"
  | "retryWebhookDelivery"
  | "beginWebhookAttempt"
  | "finishWebhookAttempt"
  | "countRecentDeadWebhookDeliveries"
> {
  return {
    async beginWebhookPing(record, id, now) {
      const params = { ...keys, id, webhook: record.webhook.id, secretId: record.secretId, now };
      if (!(await query(db, dialect, deliveryStatements.addPing, params)).length) return null;
      if (dialect.name === "sqlite") notifyUsageDay(now, enqueued);
      const [row] = await query(db, dialect, webhookStatements.webhookSecret, { ...params, id: record.webhook.id });
      return typeof row?.ciphertext === "string"
        ? { ciphertext: row.ciphertext, keyVersion: Number(row.key_version) }
        : null;
    },
    async retryWebhookDelivery(webhook, id, now) {
      const params = { ...keys, webhook, id, now };
      if ((await query(db, dialect, deliveryStatements.retryDelivery, params)).length) return "queued";
      const [row] = await query(db, dialect, deliveryStatements.findDelivery, params);
      return row ? "not_dead" : "missing";
    },
    async beginWebhookAttempt(id, instance, now, leaseUntil = now) {
      const params = { ...keys, id, instance, now, leaseUntil, maxAttempts: webhookMaxAttempts };
      const [started] = await query(db, dialect, deliveryStatements.beginDelivery, params);
      if (!started) {
        const [expired] = await query(db, dialect, deliveryStatements.expireFinalDelivery, params);
        if (expired) db.webhookOutcome?.("dead");
        return expired && expired.event !== null ? { expiredWebhookId: String(expired.webhook) } : null;
      }
      if (!started.ready) return { deferred: true };
      const [row] = await query(db, dialect, deliveryStatements.deliveryInput, params);
      if (!row) {
        if ((await query(db, dialect, deliveryStatements.skipDelivery, params)).length) {
          db.webhookOutcome?.("skipped");
        }
        return null;
      }
      const event = row.event === null ? null : messageEvent(row);
      if (event !== null && !isTailMessageEvent(event)) throw new Error("invalid webhook event");
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
    async countRecentDeadWebhookDeliveries(webhook, cutoff) {
      const [row] = await query(db, dialect, deliveryStatements.recentDeadDeliveries, { ...keys, webhook, cutoff });
      return Number(row?.total);
    },
    async finishWebhookAttempt(id, attempt, outcome) {
      const rows = await query(db, dialect, deliveryStatements.finishDelivery, {
        ...keys,
        id,
        attempt,
        ...outcome,
        revokedJobId: outcome.revokedLease?.jobId ?? null,
        instance: outcome.revokedLease?.instanceId ?? null,
        doneAt: outcome.state === "pending" ? null : outcome.now,
        nextAt: outcome.nextAt ?? null,
      });
      if (rows.length) db.webhookOutcome?.(outcome.state === "pending" ? "retry" : outcome.state);
      return rows.length > 0;
    },
  };
}

async function loadSubscriptions(db: Db, dialect: Dialect, keys: BoardKeys) {
  return (await webhookReads(db, dialect, keys).webhooks())
    .filter(({ webhook }) => webhook.enabled)
    .map(({ webhook, ownerActor, directory }) => ({
      webhook,
      ownerActor,
      directory,
      filters: parseTail(webhook.filter.tail),
    }));
}

/** Capture snapshots and persist deliveries before the fold can change them or park dispatch jobs. */
export function webhookMatcher(db: Db, dialect: Dialect, keys: BoardKeys, enqueued: JobWrites["committed"]) {
  let subscriptions: Awaited<ReturnType<typeof loadSubscriptions>> | undefined;
  return {
    invalidate() {
      subscriptions = undefined;
    },
    async match(event: BoardEvent, { findFilterActors, readMessage }: AutomationEvent, now: number) {
      // Older replicas can lease delivery jobs before they know how to decode this event.
      if (event.type === "task.blocked" || event.type === "task.assigned" || !isTailMessageEvent(event)) return;
      subscriptions ??= await loadSubscriptions(db, dialect, keys);
      if (!subscriptions.length) return;
      const previous = event.type === "message.posted" ? undefined : await readMessage(event.message);
      const threadRoot = event.thread === event.message ? undefined : await readMessage(event.thread);
      const rows: [id: string, webhook: string, payload: string][] = [];
      for (const { webhook, ownerActor, directory, filters } of subscriptions) {
        const { author, mention } = filters;
        const actors = await findFilterActors(
          author,
          mention === undefined || !directory ? undefined : mentionFilter(mention, ownerActor, true),
        );
        const resolved = {
          ...filters,
          authors: author === undefined ? undefined : eventAuthors(author, ownerActor, actors),
          mentions: mention === undefined ? undefined : eventMentions(mention, ownerActor, directory ? actors : []),
        };
        if (!matchesWebhookFilter(webhook.filter, event, resolved, previous, threadRoot)) continue;
        const digest = new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${webhook.id}:${event.id}`)),
        );
        const id = `dl_${base32(digest.subarray(0, 10))}`;
        rows.push([id, webhook.id, JSON.stringify({ id })]);
      }
      if (!rows.length) return;
      const root =
        event.thread !== event.message
          ? threadRoot
          : event.type === "message.posted"
            ? messages.messageView(event)
            : event.payload.view;
      const params = { ...keys, event: event.id, thread: event.thread, now, rows: JSON.stringify(rows) };
      await query(db, dialect, deliveryStatements.addDeliveries, { ...params, root: JSON.stringify(root ?? null) });
      if (dialect.name === "sqlite") notifyUsageDay(now, enqueued);
      await query(db, dialect, deliveryStatements.addDeliveryJobs, { ...params, kind: WEBHOOK_DELIVERY_JOB });
      enqueued(WEBHOOK_DELIVERY_JOB, now);
    },
  };
}
