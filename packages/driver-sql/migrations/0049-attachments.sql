ALTER TABLE orgs ADD COLUMN attachment_bytes BIGINT;

CREATE TABLE attachments (
  org_id BIGINT NOT NULL, board_id BIGINT NOT NULL, id TEXT NOT NULL,
  blob_key TEXT NOT NULL, sha256 TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, size BIGINT NOT NULL,
  uploader TEXT NOT NULL, at BIGINT NOT NULL, attached SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (board_id, id)
);
CREATE INDEX attachments_org_hash ON attachments (org_id, sha256);
CREATE TABLE blobs (
  org_id BIGINT NOT NULL, sha256 TEXT NOT NULL, size BIGINT NOT NULL,
  data BYTEA NOT NULL, at BIGINT NOT NULL,
  PRIMARY KEY (org_id, sha256)
);
CREATE TABLE terms (
  org_id BIGINT NOT NULL, board_id BIGINT NOT NULL, message BIGINT NOT NULL,
  term TEXT NOT NULL, value TEXT NOT NULL,
  PRIMARY KEY (board_id, message, term, value)
);
CREATE INDEX terms_lookup ON terms (board_id, term, value, message);
