import type { Fragment } from "../../sql.ts";
import { jobDeliveryId, webhookJobKinds } from "./dispatch-deliveries.ts";

export const metricDeliveryId: Fragment = {
  fragment: (dialect) => `CASE WHEN jobs.kind IN ${webhookJobKinds} THEN ${jobDeliveryId.fragment(dialect)} END`,
};

// Include unfinished deliveries even when they have no eligible job. Keep the
// job rows in the same stream so cold row estimates cannot turn joins between
// materialized results into quadratic nested loops. Resolve the globally unique
// delivery ID before checking ownership and webhook enablement.
export const dueMetricDeliveries: Fragment = {
  fragment: () => `metric_candidates AS MATERIALIZED (
    SELECT jobs.kind, jobs.available_at, d.org_id, d.board_id, w.id AS webhook, d.thread, d.event, d.created_at, d.id,
      CASE WHEN d.state = 'sending' AND d.lease_until > input.at THEN 1 ELSE 0 END AS own_lease
    FROM eligible_jobs jobs
    LEFT JOIN webhook_deliveries d ON d.id = jobs.delivery_id
    LEFT JOIN webhooks w ON w.id = d.webhook AND w.org_id = d.org_id AND w.board_id = d.board_id AND w.enabled = 1
      AND d.org_id = jobs.org_id AND d.board_id = jobs.board_id
    CROSS JOIN input
  ),
  metric_webhooks AS MATERIALIZED (
    SELECT DISTINCT org_id, board_id, webhook FROM metric_candidates WHERE webhook IS NOT NULL
  ),
  metric_rows AS (
    SELECT kind, available_at, org_id, board_id, webhook, thread, event, created_at, id, own_lease,
      0 AS active, 0 AS ping
    FROM metric_candidates
    UNION ALL
    SELECT NULL, NULL, d.org_id, d.board_id, d.webhook, d.thread, d.event, d.created_at, d.id, 0,
      CASE WHEN d.state = 'sending' AND d.lease_until > input.at THEN 1 ELSE 0 END,
      CASE WHEN d.thread IS NULL AND d.event IS NULL AND (d.state = 'pending' OR d.instance IS NOT NULL)
        THEN 1 ELSE 0 END
    FROM metric_webhooks w
    JOIN webhook_deliveries d ON d.org_id = w.org_id AND d.board_id = w.board_id AND d.webhook = w.webhook
    CROSS JOIN input
    WHERE d.state IN ('pending', 'sending')
  ),
  metric_deliveries AS (
    SELECT kind, available_at, webhook, thread, event, own_lease,
      MIN(CASE WHEN kind IS NULL THEN event END) OVER (PARTITION BY org_id, board_id, webhook, thread) AS first_event,
      SUM(active) OVER (PARTITION BY org_id, board_id, webhook, thread) AS lane_active,
      SUM(active) OVER (PARTITION BY org_id, board_id, webhook) AS webhook_active,
      SUM(ping) OVER (PARTITION BY org_id, board_id, webhook, thread ORDER BY created_at, id
        GROUPS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS earlier_pings
    FROM metric_rows
  )`,
};
