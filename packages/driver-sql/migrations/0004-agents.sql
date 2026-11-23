-- Agents claimed with a connection's secret (docs/data-model.md "Board state (folds)"). Postgres syntax;
-- driver-sqlite renders it. Expand-only: a new table. The live-profile unique index comes with the claim that
-- refuses a profile a live agent holds.

CREATE TABLE connection_agents (
  id TEXT PRIMARY KEY,
  org_id BIGINT NOT NULL, board_id BIGINT NOT NULL, connection TEXT NOT NULL,
  profile TEXT NOT NULL, profile_key TEXT NOT NULL, avatar TEXT, can TEXT NOT NULL,
  token_hash BYTEA NOT NULL UNIQUE, prev_hash BYTEA, prev_until BIGINT,
  token_expires BIGINT NOT NULL, hard_expires BIGINT NOT NULL, claim_key TEXT,
  created_at BIGINT NOT NULL, last_used_at BIGINT, revoked_at BIGINT, revoked_by TEXT
);
CREATE UNIQUE INDEX agents_claim_key ON connection_agents (connection, claim_key) WHERE claim_key IS NOT NULL;
