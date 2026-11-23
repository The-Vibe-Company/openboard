-- Memberships and the organization-level audit log (docs/data-model.md "Accounts and organizations").
-- Postgres syntax; driver-sqlite renders it. Expand-only: new tables.

CREATE TABLE memberships (
  org_id      BIGINT  NOT NULL,
  user_id     BIGINT  NOT NULL,
  role        TEXT    NOT NULL,
  created_at  BIGINT  NOT NULL,
  invited_by  BIGINT,
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX memberships_user ON memberships (user_id);

CREATE TABLE org_events (
  org_id      BIGINT  NOT NULL,
  id          BIGINT  NOT NULL,
  type        TEXT    NOT NULL,
  at          BIGINT  NOT NULL,
  actor       TEXT,
  payload     TEXT    NOT NULL,
  PRIMARY KEY (org_id, id)
);
