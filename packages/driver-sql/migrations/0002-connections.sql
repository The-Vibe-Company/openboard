-- Connections and the grants they hold (docs/data-model.md "Board state (folds)"). Postgres syntax; driver-sqlite
-- renders it. Expand-only: new tables.

CREATE TABLE grants (
  org_id BIGINT NOT NULL, board_id BIGINT NOT NULL, id BIGINT NOT NULL,
  principals TEXT NOT NULL, can TEXT NOT NULL, capped SMALLINT NOT NULL, by TEXT, at BIGINT,
  revoked SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (board_id, id)
);
CREATE TABLE grant_principals (
  board_id BIGINT NOT NULL, grant_id BIGINT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, detail TEXT NOT NULL,
  PRIMARY KEY (board_id, grant_id, kind, key)
);
CREATE INDEX grant_principals_kind ON grant_principals (board_id, kind, key);

CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  org_id BIGINT NOT NULL, board_id BIGINT NOT NULL,
  name TEXT NOT NULL, parent TEXT,
  secret_hash BYTEA NOT NULL, secret_hint TEXT NOT NULL,
  prev_secret_hash BYTEA, prev_secret_until BIGINT,
  direct SMALLINT NOT NULL, claims_max BIGINT, claims_used BIGINT NOT NULL DEFAULT 0,
  profiles TEXT NOT NULL, claim_can TEXT, token_ttl_s BIGINT NOT NULL, token_max_s BIGINT NOT NULL,
  expires_at BIGINT, created_by TEXT NOT NULL, created_at BIGINT NOT NULL, revoked_at BIGINT, revoked_by TEXT,
  UNIQUE (board_id, name)
);
