-- Seek jobs by organization without walking every row in another tenant's webhook backlog.
CREATE INDEX CONCURRENTLY jobs_kind_org_available ON jobs (kind, org_id, available_at, id);
