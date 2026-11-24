CREATE UNIQUE INDEX CONCURRENTLY jobs_key ON jobs (org_id, board_id, kind, job_key);
