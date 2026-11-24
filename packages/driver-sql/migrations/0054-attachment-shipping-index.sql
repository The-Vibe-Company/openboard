CREATE INDEX CONCURRENTLY attachments_pending_backup
  ON attachments (org_id, at, board_id, id) WHERE backup_shipped_at IS NULL;
