-- Derive scope from the reserved key namespace. This covers old writers without rewriting the live rate table.
CREATE VIEW tenant_rate_counters AS
SELECT key, window_start, n, expires_at,
  CASE
    WHEN substr(key, 1, 4) = 'org:' THEN
      CAST(substr(key, 5, NULLIF(strpos(substr(key, 5), ':'), 0) - 1) AS BIGINT)
    WHEN substr(key, 1, 6) = 'board:' THEN
      CAST(substr(key, 7, NULLIF(strpos(substr(key, 7), ':'), 0) - 1) AS BIGINT)
    ELSE NULL
  END AS org_id
FROM rate_counters;

COMMENT ON VIEW tenant_rate_counters IS 'sqlite delete from rate_counters by key, window_start';

ALTER TABLE orgs ADD COLUMN purged_at BIGINT;
