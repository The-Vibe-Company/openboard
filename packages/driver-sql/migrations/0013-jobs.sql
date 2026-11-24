CREATE TABLE jobs (
  id BIGINT GENERATED ALWAYS AS IDENTITY (NO CYCLE) PRIMARY KEY,
  org_id BIGINT NOT NULL,
  board_id BIGINT NOT NULL,
  kind TEXT NOT NULL,
  available_at BIGINT NOT NULL,
  instance_id TEXT,
  payload TEXT NOT NULL,
  FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
);

CREATE INDEX jobs_available ON jobs (kind, available_at, id);
