-- CLI device sign-in and organization-bound personal tokens (docs/data-model.md).
CREATE TABLE device_codes (
  device_hash BYTEA   PRIMARY KEY,
  user_code   TEXT    NOT NULL UNIQUE,
  client_name TEXT    NOT NULL,
  user_id     BIGINT,
  org_id      BIGINT,
  approved_at BIGINT,
  expires_at  BIGINT  NOT NULL,
  polled_at   BIGINT
);
CREATE INDEX device_codes_expiry ON device_codes (expires_at);

CREATE TABLE personal_tokens (
  id           TEXT   PRIMARY KEY,
  user_id      BIGINT NOT NULL,
  org_id       BIGINT NOT NULL,
  board_id     BIGINT,
  name         TEXT   NOT NULL,
  token_hash   BYTEA  NOT NULL UNIQUE,
  can          TEXT,
  created_at   BIGINT NOT NULL,
  expires_at   BIGINT NOT NULL,
  last_used_at BIGINT,
  revoked_at   BIGINT
);
CREATE INDEX personal_tokens_user ON personal_tokens (user_id);
