CREATE FUNCTION sync_task_expiry_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM jobs WHERE org_id = NEW.org_id AND board_id = NEW.board_id
    AND kind = 'task-expiry' AND job_key = CAST(NEW.id AS TEXT);
  INSERT INTO jobs (org_id, board_id, kind, available_at, payload, job_key)
    SELECT NEW.org_id, NEW.board_id, 'task-expiry', NEW.claim_until, '{"id":"' || CAST(NEW.id AS TEXT) || '"}', CAST(NEW.id AS TEXT)
    WHERE NEW.state = 'claimed';
  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_task_expiry_job AFTER UPDATE OF state, claim_until ON tasks
  FOR EACH ROW WHEN (OLD.state = 'claimed' OR NEW.state = 'claimed')
  EXECUTE FUNCTION sync_task_expiry_job();
