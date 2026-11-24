CREATE TABLE oidc_keys (
  issuer TEXT PRIMARY KEY,
  retry_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  document TEXT
);
