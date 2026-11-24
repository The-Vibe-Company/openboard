CREATE TABLE schemas (
  org_id BIGINT NOT NULL,
  board_id BIGINT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  version BIGINT NOT NULL,
  description TEXT,
  schema TEXT NOT NULL,
  by TEXT NOT NULL,
  at BIGINT NOT NULL,
  PRIMARY KEY (board_id, id)
);
