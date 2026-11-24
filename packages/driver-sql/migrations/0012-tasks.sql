CREATE TABLE tasks (
  org_id BIGINT NOT NULL, board_id BIGINT NOT NULL, id BIGINT NOT NULL,
  channel TEXT NOT NULL, state TEXT NOT NULL, owner TEXT NOT NULL, by_actor TEXT NOT NULL, by_profile TEXT,
  for_actor TEXT, epoch BIGINT NOT NULL DEFAULT 0,
  claim_actor TEXT, claim_until BIGINT, claim_token BYTEA,
  blocked_kind TEXT, blocked_reason TEXT, result TEXT, reason TEXT,
  created_at BIGINT NOT NULL, waiting_on BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (board_id, id)
);
CREATE INDEX tasks_ready  ON tasks (board_id, channel, state, id);
CREATE INDEX tasks_claims ON tasks (claim_until) WHERE state = 'claimed';
CREATE INDEX tasks_owner  ON tasks (board_id, owner, state, id);
CREATE INDEX tasks_for    ON tasks (board_id, for_actor, state, id) WHERE for_actor IS NOT NULL;

CREATE TABLE task_needs (board_id BIGINT NOT NULL, task BIGINT NOT NULL, needs BIGINT NOT NULL, PRIMARY KEY (board_id, task, needs));
CREATE INDEX task_needs_reverse ON task_needs (board_id, needs, task);
