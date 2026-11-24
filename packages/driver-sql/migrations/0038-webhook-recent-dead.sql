CREATE INDEX CONCURRENTLY deliveries_recent_dead
  ON webhook_deliveries (org_id, board_id, webhook, state, done_at)
  WHERE state = 'dead' AND event IS NOT NULL;
