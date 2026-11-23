-- People, their sign-in identities and their browser sessions (docs/data-model.md "Accounts and organizations").
-- Postgres syntax; driver-sqlite renders it. Expand-only: new tables, outside any tenant.

CREATE TABLE users (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id   TEXT    NOT NULL UNIQUE,
  handle      TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  email       TEXT,
  avatar      TEXT,
  created_at  BIGINT  NOT NULL,
  disabled_at BIGINT
);

CREATE TABLE identities (
  provider    TEXT    NOT NULL,
  subject     TEXT    NOT NULL,
  user_id     BIGINT  NOT NULL,
  email       TEXT,
  created_at  BIGINT  NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX identities_user ON identities (user_id);

CREATE TABLE sessions (
  id_hash     BYTEA   PRIMARY KEY,
  user_id     BIGINT  NOT NULL,
  csrf        TEXT    NOT NULL,
  created_at  BIGINT  NOT NULL,
  seen_at     BIGINT  NOT NULL,
  expires_at  BIGINT  NOT NULL,
  revoked_at  BIGINT
);
CREATE INDEX sessions_user ON sessions (user_id);
