CREATE TABLE schedules (
  org_id BIGINT NOT NULL, board_id BIGINT NOT NULL, id BIGINT NOT NULL,
  channel TEXT NOT NULL, re BIGINT, text TEXT NOT NULL, labels TEXT NOT NULL, no_sync SMALLINT NOT NULL,
  attachments TEXT NOT NULL, first_at BIGINT NOT NULL, every_ms BIGINT, until_at BIGINT, times BIGINT,
  sent BIGINT NOT NULL DEFAULT 0, next_at BIGINT, last_message BIGINT, state TEXT NOT NULL, canceled TEXT,
  by_actor TEXT NOT NULL, by_principal TEXT NOT NULL, by_profile TEXT, creator TEXT NOT NULL,
  blind SMALLINT NOT NULL DEFAULT 0, created_at BIGINT NOT NULL,
  author TEXT NOT NULL, mentions TEXT NOT NULL, blocks TEXT NOT NULL,
  PRIMARY KEY (board_id, id)
);
CREATE INDEX schedules_due ON schedules (next_at) WHERE state = 'pending';
