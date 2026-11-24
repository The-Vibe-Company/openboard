CREATE INDEX CONCURRENTLY orgs_pending_purge ON orgs (deleted_at, id)
  WHERE deleted_at IS NOT NULL AND purged_at IS NULL;
CREATE INDEX CONCURRENTLY jobs_org_kind ON jobs (org_id, kind);
CREATE INDEX CONCURRENTLY device_codes_org ON device_codes (org_id) WHERE org_id IS NOT NULL;
CREATE INDEX CONCURRENTLY personal_tokens_org ON personal_tokens (org_id);
CREATE INDEX CONCURRENTLY jobs_board ON jobs (board_id);

-- Match the org_id expression in tenant_rate_counters.
CREATE INDEX CONCURRENTLY rate_counters_org ON rate_counters ((
  CASE
    WHEN substr(key, 1, 4) = 'org:' THEN
      CAST(substr(key, 5, NULLIF(strpos(substr(key, 5), ':'), 0) - 1) AS BIGINT)
    WHEN substr(key, 1, 6) = 'board:' THEN
      CAST(substr(key, 7, NULLIF(strpos(substr(key, 7), ':'), 0) - 1) AS BIGINT)
    ELSE NULL
  END
), key, window_start);
