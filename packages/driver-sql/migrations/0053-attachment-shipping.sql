ALTER TABLE attachments ADD COLUMN backup_shipped_at BIGINT;
ALTER TABLE attachments ADD COLUMN backup_retry_at BIGINT;
