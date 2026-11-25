import { WEBHOOK_DELIVERY_JOB, WEBHOOK_RESEND_JOB } from "@openboard/ports";
import type { Fragment } from "../../sql.ts";
import { earlierDelivery } from "../webhooks/deliveries.ts";

export const webhookJobKinds = `('${WEBHOOK_DELIVERY_JOB}', '${WEBHOOK_RESEND_JOB}')`;

export const jobDeliveryId: Fragment = {
  fragment: ({ name }) => (name === "postgres" ? "jobs.payload::jsonb ->> 'id'" : "json_extract(jobs.payload, '$.id')"),
};

// Resolve the globally unique delivery ID before joining tenant data or checking its lane.
const jobDelivery: Fragment = {
  fragment: (dialect) => `FROM (
    SELECT org_id, board_id, id, webhook, thread, event, created_at FROM webhook_deliveries
    WHERE id = ${jobDeliveryId.fragment(dialect)}
    LIMIT 1
  ) d
  WHERE d.org_id = jobs.org_id AND d.board_id = jobs.board_id
    AND (SELECT w.enabled FROM webhooks w WHERE w.id = d.webhook
      AND w.org_id = d.org_id AND w.board_id = d.board_id) = 1`,
};

// A blocked follower must not keep the timer awake while its lane head waits.
// A scalar lookup keeps Postgres from precomputing blocked lanes for the whole outbox.
export const readyDeliveryLane: Fragment = {
  fragment: (dialect) => `(jobs.kind NOT IN ${webhookJobKinds} OR (
    SELECT 1 ${jobDelivery.fragment(dialect)} AND ${earlierDelivery.fragment(dialect)} LIMIT 1
  ) IS NULL)`,
};

// A finishing runner immediately picks again. A waiting peer can sleep until
// the first slot could expire, unless newly enqueued work wakes it sooner.
// Four live leases already fill the webhook, so only the first four matter.
export const dispatchAt: Fragment = {
  fragment: (dialect) => `CASE WHEN jobs.kind IN ${webhookJobKinds} THEN
    ${dialect.name === "postgres" ? "GREATEST" : "MAX"}(jobs.available_at, COALESCE((
      SELECT (
        SELECT CASE WHEN COUNT(*) >= 4 OR COUNT(CASE WHEN active.thread IS NOT DISTINCT FROM d.thread THEN 1 END) > 0
          THEN MIN(active.lease_until) END
        FROM (
          SELECT active.thread, active.lease_until FROM webhook_deliveries active
          WHERE active.org_id = d.org_id AND active.board_id = d.board_id AND active.webhook = d.webhook
            AND active.id <> d.id AND active.state = 'sending' AND active.lease_until > (SELECT at FROM input)
          ORDER BY active.lease_until LIMIT 4
        ) active
      ) ${jobDelivery.fragment(dialect)}
    ), jobs.available_at))
    ELSE jobs.available_at END`,
};
