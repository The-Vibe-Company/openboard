-- board_id = 0 tracks the organization log. A reserved end survives an interrupted upload.
CREATE TABLE shipping (
  org_id BIGINT NOT NULL,
  board_id BIGINT NOT NULL,
  shipped BIGINT NOT NULL,
  pending BIGINT NOT NULL,
  upload_until BIGINT NOT NULL,
  PRIMARY KEY (org_id, board_id)
);

-- One recurring dispatcher uses the implicit board for routing only. It runs only when registered in hosted mode.
INSERT INTO jobs (org_id, board_id, kind, available_at, payload)
SELECT org_id, id, 'ship-log', 0, '{}' FROM boards WHERE org_id = 1 AND slug = 'main';
