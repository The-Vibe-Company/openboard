-- Reprojection sets a transaction-private negative projection while folding historical rows.
-- Existing job IDs and worker leases survive the rebuild.
CREATE OR REPLACE FUNCTION sync_task_expiry_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM jobs WHERE org_id = NEW.org_id AND board_id = NEW.board_id
    AND kind = 'task-expiry' AND job_key = CAST(NEW.id AS TEXT)
    AND NOT EXISTS (SELECT 1 FROM boards WHERE org_id = NEW.org_id AND id = NEW.board_id AND projection < 0);
  INSERT INTO jobs (org_id, board_id, kind, available_at, payload, job_key)
    SELECT NEW.org_id, NEW.board_id, 'task-expiry', NEW.claim_until, '{"id":"' || CAST(NEW.id AS TEXT) || '"}', CAST(NEW.id AS TEXT)
    WHERE NEW.state = 'claimed'
      AND NOT EXISTS (SELECT 1 FROM boards WHERE org_id = NEW.org_id AND id = NEW.board_id AND projection < 0);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sync_schedule_send_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM jobs WHERE org_id = NEW.org_id AND board_id = NEW.board_id
    AND kind = 'schedule-send' AND job_key = CAST(NEW.id AS TEXT)
    AND NOT EXISTS (SELECT 1 FROM boards WHERE org_id = NEW.org_id AND id = NEW.board_id AND projection < 0);
  INSERT INTO jobs (org_id, board_id, kind, available_at, payload, job_key)
    SELECT NEW.org_id, NEW.board_id, 'schedule-send', NEW.next_at,
      '{"id":"' || CAST(NEW.id AS TEXT) || '","n":' || CAST(NEW.sent AS TEXT) || '}', CAST(NEW.id AS TEXT)
    WHERE NEW.state = 'pending' AND NEW.next_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM boards WHERE org_id = NEW.org_id AND id = NEW.board_id AND projection < 0);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION notify_schedule_send_ended() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM boards WHERE org_id = NEW.org_id AND id = NEW.board_id AND projection < 0) THEN
    PERFORM pg_notify('ob_jobs', '["schedule-send",0,"refresh"]');
  END IF;
  RETURN NULL;
END;
$$;
