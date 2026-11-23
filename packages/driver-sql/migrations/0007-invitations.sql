-- Link invitations (docs/data-model.md "Accounts and organizations").

CREATE TABLE invitations (
  id          TEXT    PRIMARY KEY,
  org_id      BIGINT  NOT NULL,
  token_hash  BYTEA   NOT NULL UNIQUE,
  email       TEXT,
  role        TEXT    NOT NULL CHECK (role IN ('admin', 'member')),
  created_by  BIGINT  NOT NULL,
  created_at  BIGINT  NOT NULL,
  expires_at  BIGINT  NOT NULL,
  sent_at     BIGINT,
  accepted_by BIGINT,
  accepted_at BIGINT,
  revoked_at  BIGINT
);
CREATE INDEX invitations_org ON invitations (org_id, created_at);
