---
id: 176
title: Wake a tail on one instance from a write on another
milestone: M6-high-availability
package: driver-postgres
writes:
  - packages/driver-postgres/src/broadcaster.ts
  - packages/driver-postgres/src/dialect.ts
  - packages/driver-postgres/test/broadcaster.test.ts
  - packages/driver-sql/src/db.ts
  - packages/driver-sql/src/views/boards.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/driver-sqlite/src/dialect.ts
conformance: []
modes: [local, hosted]
depends_on: [166, 170, 174]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an agent following a board, I receive a post the moment it is written, whichever instance wrote it.

## Done when
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/driver-postgres/test/broadcaster.test.ts` passes: with two drivers (two instances) on one database, a subscriber on instance 1 receives every position written through instance 2, in order, each once, and several notifications arriving together cause one read from the subscriber's cursor
- [ ] in the same file, a write that rolls back sends no notification, and `bun test packages/driver-sqlite` still passes

## Out of scope
- Delivery when a notification is lost (178); catching up after the listener reconnects (179).
- The HTTP suites on two instances (177); conformance behind the proxy (186).

## Notes
- docs/architecture.md "Live fan-out across instances", D36. Each write sends `pg_notify('ob_events', '<board_id>:<head>')` inside its transaction, so Postgres delivers it only on commit; each instance keeps one dedicated listening connection (`sql.listen`, never through the pool, never through a transaction-mode pooler), and on a notification for a board with local subscribers it wakes them through the port 97 defined. The instance that wrote still wakes its own subscribers at once (162).
- The notify belongs to the shared write path (`boardView().write` in `packages/driver-sql/src/views/messages.ts`, after `setHead` in `packages/driver-sql/src/views/boards.ts`) as a dialect hook in `packages/driver-sql/src/db.ts`: a statement on Postgres, nothing on SQLite, whose in-process bus already does the job. A `SELECT pg_notify(…)` without `FROM` passes the registry's tenant check (`packages/driver-sql/src/statements.ts`).
- Depends on 166 and 174 as well as 170: they are the last M5 tickets touching files M6 changes (`packages/server/test/support/drivers.ts`, `packages/driver-postgres/src/pool.ts`, `.github/workflows/ci.yml`), and docs/project.md starts a milestone when the one before is done.
- Swapped with 177 in `.veebee/cut.md`: the HTTP suites on two instances include the long-poll and SSE tests of M3 (97, 99), which only pass once a write on one instance wakes the other.
