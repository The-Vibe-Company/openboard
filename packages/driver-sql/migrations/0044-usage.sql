-- Days are UTC midnight in epoch milliseconds, like boards.daily_event_day.
CREATE TABLE usage_daily (
  org_id BIGINT NOT NULL,
  day BIGINT NOT NULL,
  events BIGINT NOT NULL,
  bytes_stored BIGINT NOT NULL,
  deliveries BIGINT NOT NULL,
  active_agents BIGINT NOT NULL,
  PRIMARY KEY (org_id, day)
);

-- A pending job covers all deliveries of its organization that share the date.
CREATE VIEW usage_pending_days AS
SELECT org_id, job_key FROM jobs j
WHERE j.kind = 'usage-rollup'
  AND NOT EXISTS (SELECT 1 FROM usage_daily u WHERE u.org_id = j.org_id AND u.day = CAST(j.job_key AS BIGINT));

-- A board-local key keeps concurrent writes on separate boards independent.
CREATE FUNCTION queue_usage_day() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_at BIGINT;
BEGIN
  IF TG_ARGV[0] = 'at' THEN
    source_at := NEW.at;
  ELSE
    source_at := NEW.created_at;
  END IF;
  INSERT INTO jobs (org_id, board_id, kind, available_at, payload, job_key)
  SELECT NEW.org_id, NEW.board_id, 'usage-rollup', day + 86400000, '{"day":' || CAST(day AS TEXT) || '}', CAST(day AS TEXT)
  FROM (SELECT source_at - (source_at % 86400000 + 86400000) % 86400000 AS day) AS days
  WHERE NOT EXISTS (SELECT 1 FROM usage_daily u WHERE u.org_id = NEW.org_id AND u.day = days.day)
    AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.org_id = NEW.org_id AND j.board_id = NEW.board_id
      AND j.kind = 'usage-rollup'
      AND j.job_key = CAST(days.day AS TEXT))
  ON CONFLICT (org_id, board_id, kind, job_key) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER queue_usage_event AFTER INSERT ON events
FOR EACH ROW EXECUTE FUNCTION queue_usage_day('at');

-- A write timestamp can precede midnight even when the write acquires its lock after the rollup.
-- The first update serializes late writes to this day before inspecting the log for prior agent activity.
CREATE FUNCTION adjust_late_usage_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE usage_daily SET events = events + 1
  WHERE org_id = NEW.org_id AND day = NEW.at - (NEW.at % 86400000 + 86400000) % 86400000;

  UPDATE usage_daily SET active_agents = active_agents + 1
  WHERE org_id = NEW.org_id AND day = NEW.at - (NEW.at % 86400000 + 86400000) % 86400000
    AND NEW.actor LIKE 'ob:conn:%+%' AND NEW.type <> 'actor.seen'
    AND NOT EXISTS (
      SELECT 1 FROM boards b JOIN events e ON e.board_id = b.id AND e.org_id = b.org_id
      WHERE b.org_id = NEW.org_id AND e.at >= usage_daily.day AND e.at < usage_daily.day + 86400000
        AND e.actor = NEW.actor AND e.type <> 'actor.seen' AND (e.board_id <> NEW.board_id OR e.id <> NEW.id)
    );
  RETURN NEW;
END;
$$;

CREATE TRIGGER adjust_late_usage_event AFTER INSERT ON events
FOR EACH ROW EXECUTE FUNCTION adjust_late_usage_event();
