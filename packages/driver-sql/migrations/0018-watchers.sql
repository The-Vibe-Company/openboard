CREATE TABLE watcher_registrations (
  org_id BIGINT NOT NULL,
  board_id BIGINT NOT NULL,
  owner TEXT NOT NULL,
  watch TEXT NOT NULL,
  hash TEXT NOT NULL,
  at BIGINT NOT NULL,
  PRIMARY KEY (board_id, owner)
);

CREATE TABLE watcher_matches (
  org_id BIGINT NOT NULL,
  board_id BIGINT NOT NULL,
  id TEXT NOT NULL,
  owner TEXT NOT NULL,
  watcher TEXT NOT NULL,
  thread BIGINT NOT NULL,
  event BIGINT NOT NULL,
  state TEXT NOT NULL,
  lease TEXT,
  lease_until BIGINT,
  attempt BIGINT NOT NULL DEFAULT 0,
  next_at BIGINT NOT NULL,
  needs_actor_directory SMALLINT NOT NULL,
  PRIMARY KEY (board_id, id)
);
CREATE INDEX matches_next ON watcher_matches (board_id, owner, state, thread, event, id);
