-- Bounded platform retention picks by age, using the existing primary keys for deletion.
CREATE INDEX CONCURRENTLY deliveries_finished_retention
  ON webhook_deliveries (done_at) WHERE state IN ('done', 'skipped');
CREATE INDEX CONCURRENTLY deliveries_dead_retention
  ON webhook_deliveries (done_at) WHERE state = 'dead';
CREATE INDEX CONCURRENTLY inbound_seen_retention ON inbound_seen (at);
CREATE INDEX CONCURRENTLY matches_done_retention ON watcher_matches (next_at) WHERE state = 'done';
CREATE INDEX CONCURRENTLY sessions_retention ON sessions (expires_at);
CREATE INDEX CONCURRENTLY invitations_accepted_retention
  ON invitations (accepted_at) WHERE accepted_at IS NOT NULL;
CREATE INDEX CONCURRENTLY invitations_expired_retention
  ON invitations (expires_at) WHERE accepted_at IS NULL;
