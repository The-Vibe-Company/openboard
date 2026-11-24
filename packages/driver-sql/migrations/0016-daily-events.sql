ALTER TABLE boards ADD COLUMN daily_event_day BIGINT;
-- The tally includes the head it covers so new instances can account for intervening old writes.
ALTER TABLE boards ADD COLUMN daily_event_tally TEXT;
