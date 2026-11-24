-- Find the latest event for one message at a cursor without scanning its thread's replies.
CREATE INDEX CONCURRENTLY events_message ON events (board_id, message, id) WHERE message IS NOT NULL;
