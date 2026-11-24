-- Build indexes on live outbox and queue tables without blocking inserts.
CREATE INDEX CONCURRENTLY usage_deliveries_day ON webhook_deliveries (org_id, created_at);
CREATE INDEX CONCURRENTLY usage_pending_org_day ON jobs (org_id, job_key) WHERE kind = 'usage-rollup';
