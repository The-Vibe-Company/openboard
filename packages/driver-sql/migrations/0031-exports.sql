CREATE TABLE org_exports (
  org_id BIGINT NOT NULL,
  id TEXT NOT NULL,
  started_at BIGINT,
  expires_at BIGINT,
  failed_at BIGINT,
  PRIMARY KEY (org_id, id)
);

CREATE TABLE org_export_audit (
  org_id BIGINT NOT NULL,
  id BIGINT NOT NULL,
  type TEXT NOT NULL,
  at BIGINT NOT NULL,
  actor TEXT NOT NULL,
  export_id TEXT NOT NULL,
  PRIMARY KEY (org_id, id)
);
