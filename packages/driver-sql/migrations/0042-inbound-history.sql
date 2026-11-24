CREATE INDEX CONCURRENTLY inbound_seen_history
  ON inbound_seen (org_id, board_id, endpoint, at DESC, event_id DESC);
