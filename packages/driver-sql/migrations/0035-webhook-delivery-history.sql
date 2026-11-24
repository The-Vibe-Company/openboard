CREATE INDEX CONCURRENTLY deliveries_history
  ON webhook_deliveries (org_id, board_id, webhook, created_at DESC, id DESC);
CREATE INDEX CONCURRENTLY deliveries_history_state
  ON webhook_deliveries (org_id, board_id, webhook, state, created_at DESC, id DESC);
