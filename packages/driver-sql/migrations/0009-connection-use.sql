-- Reading when each connection was last used and listing its agents (docs/data-model.md "Board state (folds)").
-- Postgres syntax; driver-sqlite renders it. Expand-only: two new indexes. The events index holds only the writes of
-- connections and their agents, so other writes do not pay for it.

CREATE INDEX events_connection ON events (board_id, principal, id) WHERE principal LIKE 'ob:conn:%';
CREATE INDEX connection_agents_board ON connection_agents (board_id, connection, created_at);
