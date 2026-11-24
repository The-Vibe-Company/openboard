CREATE TABLE webhooks (
  id TEXT PRIMARY KEY,
  org_id BIGINT NOT NULL,
  board_id BIGINT NOT NULL,
  name TEXT NOT NULL,
  owner_actor TEXT NOT NULL,
  owner TEXT NOT NULL,
  secret_id TEXT NOT NULL,
  enabled SMALLINT NOT NULL,
  directory SMALLINT NOT NULL,
  config TEXT NOT NULL,
  UNIQUE (board_id, name)
);

CREATE TABLE webhook_secrets (
  id TEXT PRIMARY KEY,
  org_id BIGINT NOT NULL,
  board_id BIGINT NOT NULL,
  webhook_id TEXT NOT NULL,
  key_version BIGINT NOT NULL,
  ciphertext TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE webhook_deliveries (
  id TEXT PRIMARY KEY,
  org_id BIGINT NOT NULL,
  board_id BIGINT NOT NULL,
  webhook TEXT NOT NULL,
  event BIGINT NOT NULL,
  thread BIGINT NOT NULL,
  state TEXT NOT NULL,
  attempt BIGINT NOT NULL DEFAULT 0,
  next_at BIGINT NOT NULL,
  lease_until BIGINT,
  instance TEXT,
  last_status BIGINT,
  last_error TEXT,
  created_at BIGINT NOT NULL,
  done_at BIGINT,
  root_view TEXT,
  UNIQUE (webhook, event)
);
CREATE INDEX deliveries_due ON webhook_deliveries (next_at) WHERE state IN ('pending', 'sending');
CREATE INDEX deliveries_lane ON webhook_deliveries (webhook, thread, event);
