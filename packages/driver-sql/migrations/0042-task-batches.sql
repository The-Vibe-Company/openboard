CREATE TABLE task_batches (
  org_id BIGINT NOT NULL,
  board_id BIGINT NOT NULL,
  principal TEXT NOT NULL,
  id TEXT NOT NULL,
  digest TEXT NOT NULL,
  tasks TEXT NOT NULL,
  PRIMARY KEY (board_id, principal, id)
);
