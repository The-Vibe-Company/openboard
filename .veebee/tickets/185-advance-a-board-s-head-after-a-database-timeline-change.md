---
id: 185
title: Advance a board's head after a database timeline change
milestone: M6-high-availability
package: driver-postgres
writes:
  - packages/driver-postgres/src/timeline.ts
  - packages/driver-postgres/src/dialect.ts
  - packages/driver-postgres/test/timeline.test.ts
  - packages/driver-sql/src/db.ts
  - packages/driver-sql/src/views/boards.ts
  - packages/driver-sqlite/src/dialect.ts
  - packages/driver-sqlite/test/timeline.test.ts
  - packages/driver-sql/test/actors.test.ts
  - docs/data-model.md
  - docs/decisions.md
conformance: []
modes: [local, hosted]
depends_on: [164, 176]
status: claimed
claimed_by: claude-opus-5-5
issue: 265
---

## What the user does
As an agent holding a cursor, after the database fails over and loses its last commits, I still receive every new event instead of silently skipping the ones that reuse old IDs.

## Done when
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/driver-postgres/test/timeline.test.ts` passes: on a board whose stored `timeline` differs from the server's (a simulated failover that rolled `head` back below a cursor a reader holds), the next write advances `head` by 1,000,000 before allocating its ID, records the new timeline, and the reader's `id > cursor` read returns it; the write after it allocates `head + 1` as usual
- [ ] `bun test packages/driver-sqlite` still passes, and a SQLite write never advances by 1,000,000

## Out of scope
- Synchronous replication, the alternative of D37: a database setting, not code.
- Moving to a failover database: a change of `OPENBOARD_DATABASE_URL` only (docs/architecture.md "Upgrade path to a failover database").

## Notes
- docs/data-model.md "Failover and cursor safety", D37. `boards.timeline` exists since migration 0001; the lock statement (`boardStatements.lockBoard` in `packages/driver-sql/src/views/boards.ts`) reads it with `head`, and the dialect supplies the server timeline (`SELECT timeline_id FROM pg_control_checkpoint()` on Postgres, a constant on SQLite).
- Read the timeline once per pooled connection when it opens, or join it to the lock statement in the same round trip: either keeps a write at its round-trip count (174 fails the bench otherwise).
- Unverified (D37): whether the app role may call `pg_control_checkpoint()` without `pg_monitor`. Check it on the test Postgres as a non-superuser role, and say in the PR what Railway's role must be granted; staging confirms it (189).
- Depends on 176 because both change `packages/driver-sql/src/db.ts` and the dialects.
