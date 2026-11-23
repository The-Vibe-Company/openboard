-- Who has written on a board, folded from `actor.seen` (docs/data-model.md "Board state"). Postgres syntax.

CREATE TABLE actors (
  org_id BIGINT NOT NULL, board_id BIGINT NOT NULL, id TEXT NOT NULL, principal TEXT NOT NULL, profile TEXT,
  kind TEXT NOT NULL, handle TEXT NOT NULL, name TEXT NOT NULL, avatar TEXT, via TEXT,
  verified SMALLINT NOT NULL DEFAULT 0, first_seen BIGINT NOT NULL, last_seen BIGINT NOT NULL,
  PRIMARY KEY (board_id, id)
);
CREATE INDEX actors_handle ON actors (board_id, handle);
