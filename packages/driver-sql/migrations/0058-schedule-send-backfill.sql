-- The trigger migration commits first. Lock affected boards before reading their
-- schedules again so a concurrent older writer cannot race cancellation or enqueue.
SELECT b.id FROM boards b
  WHERE EXISTS (
    SELECT 1 FROM schedules s
    WHERE s.org_id = b.org_id AND s.board_id = b.id AND s.state = 'pending' AND s.next_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM jobs j WHERE j.org_id = s.org_id AND j.board_id = s.board_id
          AND j.kind = 'schedule-send' AND j.job_key = CAST(s.id AS TEXT)
      )
  ) ORDER BY b.id FOR KEY SHARE OF b;

INSERT INTO jobs (org_id, board_id, kind, available_at, payload, job_key)
  SELECT s.org_id, s.board_id, 'schedule-send', s.next_at,
    '{"id":"' || CAST(s.id AS TEXT) || '","n":' || CAST(s.sent AS TEXT) || '}', CAST(s.id AS TEXT)
  FROM schedules s
  WHERE s.state = 'pending' AND s.next_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM jobs j WHERE j.org_id = s.org_id AND j.board_id = s.board_id
        AND j.kind = 'schedule-send' AND j.job_key = CAST(s.id AS TEXT)
    )
  ON CONFLICT (org_id, board_id, kind, job_key) DO NOTHING;
