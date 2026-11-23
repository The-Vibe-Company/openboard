-- Tenancy, the board log, and the first folds (docs/data-model.md "DDL"). Postgres syntax; driver-sqlite renders it.

CREATE TABLE orgs (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug        TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  created_by  BIGINT  NOT NULL,
  created_at  BIGINT  NOT NULL,
  deleted_at  BIGINT,
  quotas      TEXT
);

CREATE TABLE boards (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id        BIGINT  NOT NULL,
  slug          TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  head          BIGINT  NOT NULL DEFAULT 0,
  next_schedule BIGINT  NOT NULL DEFAULT 1,
  next_grant    BIGINT  NOT NULL DEFAULT 4,
  timeline      BIGINT  NOT NULL DEFAULT 0,
  projection    BIGINT  NOT NULL DEFAULT 0,
  created_at    BIGINT  NOT NULL,
  deleted_at    BIGINT,
  UNIQUE (org_id, slug)
);

CREATE TABLE events (
  org_id     BIGINT  NOT NULL,
  board_id   BIGINT  NOT NULL,
  id         BIGINT  NOT NULL,
  type       TEXT    NOT NULL,
  v          INTEGER NOT NULL DEFAULT 1,
  at         BIGINT  NOT NULL,
  thread     BIGINT,
  message    BIGINT,
  channel    TEXT,
  actor      TEXT,
  principal  TEXT,
  visibility SMALLINT NOT NULL,
  payload    TEXT    NOT NULL,
  PRIMARY KEY (board_id, id)
);
CREATE INDEX events_thread  ON events (board_id, thread, id)  WHERE thread IS NOT NULL;
CREATE INDEX events_channel ON events (board_id, channel, id) WHERE channel IS NOT NULL;

CREATE TABLE messages (
  org_id BIGINT NOT NULL, board_id BIGINT NOT NULL, id BIGINT NOT NULL,
  channel TEXT NOT NULL, re BIGINT, reply_to BIGINT,
  actor TEXT NOT NULL, principal TEXT NOT NULL, profile TEXT,
  client_id TEXT, text TEXT NOT NULL, text_lower TEXT NOT NULL,
  labels TEXT NOT NULL DEFAULT '{}', no_sync SMALLINT NOT NULL, blind SMALLINT NOT NULL DEFAULT 0,
  schedule_id BIGINT, schedule_n BIGINT,
  version BIGINT NOT NULL, revision BIGINT NOT NULL DEFAULT 0, deleted SMALLINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  replies BIGINT NOT NULL DEFAULT 0, last_reply BIGINT, active BIGINT,
  view TEXT NOT NULL,
  PRIMARY KEY (board_id, id)
);
CREATE INDEX messages_channel       ON messages (board_id, channel, id);
CREATE INDEX messages_re            ON messages (board_id, re, id) WHERE re IS NOT NULL;
CREATE INDEX messages_actor         ON messages (board_id, actor, id);
CREATE INDEX messages_principal     ON messages (board_id, principal, id);
CREATE INDEX threads_active         ON messages (board_id, active, id) WHERE re IS NULL;
CREATE INDEX threads_channel_active ON messages (board_id, channel, active, id) WHERE re IS NULL;
CREATE UNIQUE INDEX messages_client ON messages (board_id, client_id) WHERE client_id IS NOT NULL;
CREATE UNIQUE INDEX messages_sched  ON messages (board_id, schedule_id, schedule_n) WHERE schedule_id IS NOT NULL;

CREATE TABLE channels (
  org_id BIGINT NOT NULL, board_id BIGINT NOT NULL, path TEXT NOT NULL, created_at BIGINT NOT NULL,
  last_index BIGINT, messages BIGINT NOT NULL DEFAULT 0, threads BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (board_id, path)
);

-- The implicit organization `local` and its board `main` (docs/data-model.md "Tenancy"): the first rows, so id 1.
INSERT INTO orgs (slug, name, created_by, created_at) VALUES ('local', 'Local', 0, 0);
INSERT INTO boards (org_id, slug, name, created_at) VALUES (1, 'main', 'main', 0);
