-- Compaction finds an actor's first and latest sighting without scanning the board's history.
CREATE INDEX CONCURRENTLY events_actor_sightings ON events (board_id, actor, id)
  WHERE type = 'actor.seen' AND visibility = 1;

-- Scan a bounded chronological window without walking other event types.
CREATE INDEX CONCURRENTLY events_actor_sightings_age ON events (board_id, at, id)
  WHERE type = 'actor.seen' AND visibility = 1;
