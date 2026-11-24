CREATE TABLE inbound_seen (
  org_id BIGINT NOT NULL,
  board_id BIGINT NOT NULL,
  endpoint TEXT NOT NULL,
  event_id TEXT NOT NULL,
  at BIGINT NOT NULL,
  result TEXT NOT NULL,
  PRIMARY KEY (endpoint, event_id)
);
