CREATE TABLE rate_counters (
  key TEXT NOT NULL,
  window_start BIGINT NOT NULL,
  n BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX rate_counters_expiry ON rate_counters (expires_at);
