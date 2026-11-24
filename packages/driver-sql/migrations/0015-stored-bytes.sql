-- A counter is valid at the head it covers. Older writers advance head without advancing this marker.
ALTER TABLE boards ADD COLUMN stored_bytes BIGINT DEFAULT 0;
ALTER TABLE boards ADD COLUMN stored_bytes_head BIGINT DEFAULT 0;
