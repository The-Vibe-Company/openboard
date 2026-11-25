CREATE FUNCTION sync_schedule_send_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM jobs WHERE org_id = NEW.org_id AND board_id = NEW.board_id
    AND kind = 'schedule-send' AND job_key = CAST(NEW.id AS TEXT);
  INSERT INTO jobs (org_id, board_id, kind, available_at, payload, job_key)
    SELECT NEW.org_id, NEW.board_id, 'schedule-send', NEW.next_at,
      '{"id":"' || CAST(NEW.id AS TEXT) || '","n":' || CAST(NEW.sent AS TEXT) || '}', CAST(NEW.id AS TEXT)
    WHERE NEW.state = 'pending' AND NEW.next_at IS NOT NULL;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_schedule_send_job_insert AFTER INSERT ON schedules
  FOR EACH ROW WHEN (NEW.state = 'pending') EXECUTE FUNCTION sync_schedule_send_job();

CREATE TRIGGER sync_schedule_send_job_update AFTER UPDATE OF state, next_at ON schedules
  FOR EACH ROW WHEN (OLD.state = 'pending') EXECUTE FUNCTION sync_schedule_send_job();

-- A peer may still have a timer for the canceled slot or its claimed lease.
CREATE FUNCTION notify_schedule_send_ended() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('ob_jobs', '["schedule-send",0,"refresh"]');
  RETURN NULL;
END;
$$;

CREATE TRIGGER notify_schedule_send_ended AFTER UPDATE OF state ON schedules
  FOR EACH ROW WHEN (OLD.state = 'pending' AND NEW.state <> 'pending')
  EXECUTE FUNCTION notify_schedule_send_ended();
