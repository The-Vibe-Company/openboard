ALTER TABLE attachments ADD COLUMN gc_enqueued SMALLINT;

-- Older Postgres replicas can still upload while the new version rolls out.
CREATE FUNCTION queue_legacy_attachment_gc() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO jobs (org_id, board_id, kind, available_at, payload)
    VALUES (NEW.org_id, NEW.board_id, 'blob-gc', NEW.at + 86400000, '{"id":"' || NEW.id || '"}');
  NEW.gc_enqueued := 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER queue_legacy_attachment_gc BEFORE INSERT ON attachments
  FOR EACH ROW WHEN (NEW.gc_enqueued IS NULL AND NEW.attached = 0)
  EXECUTE FUNCTION queue_legacy_attachment_gc();
