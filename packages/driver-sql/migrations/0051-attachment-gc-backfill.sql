-- Seed routing jobs separately from the schema change. Workers backfill each board in batches.
INSERT INTO jobs (org_id, board_id, kind, available_at, payload)
  SELECT b.org_id, b.id, 'blob-gc', 0, '{"backfill":true}' FROM boards b
  WHERE EXISTS (
    SELECT 1 FROM attachments a
    WHERE a.org_id = b.org_id AND a.board_id = b.id AND a.attached = 0 AND a.gc_enqueued IS NULL
  ) ORDER BY b.id FOR KEY SHARE OF b;
