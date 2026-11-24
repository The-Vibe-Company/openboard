CREATE TABLE inbound_endpoints (
  id TEXT PRIMARY KEY,
  org_id BIGINT NOT NULL,
  board_id BIGINT NOT NULL,
  name TEXT NOT NULL,
  grant_id BIGINT NOT NULL,
  config TEXT NOT NULL,
  UNIQUE (board_id, name)
);
CREATE TABLE inbound_secrets (
  id TEXT PRIMARY KEY,
  org_id BIGINT NOT NULL,
  board_id BIGINT NOT NULL,
  key_version BIGINT NOT NULL,
  ciphertext TEXT NOT NULL
);
