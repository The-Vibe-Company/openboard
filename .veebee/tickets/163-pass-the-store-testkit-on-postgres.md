---
id: 163
title: Pass the store testkit on Postgres
milestone: M5-postgres-driver
package: driver-postgres
writes:
  - packages/driver-postgres/test/testkit.test.ts
  - packages/driver-postgres/src/pool.ts
  - packages/driver-postgres/src/dialect.ts
  - packages/driver-postgres/src/broadcaster.ts
  - packages/driver-sql/src/views/**
  - packages/driver-sql/src/sql.ts
  - packages/driver-sql/src/db.ts
  - packages/driver-sqlite/src/dialect.ts
  - packages/ports/testkit/store/**
  - packages/ports/testkit/broadcaster.test-suite.ts
conformance: []
modes: [local, hosted]
depends_on: [162]
status: draft
claimed_by: null
issue: 243
---

## What the user does
As a contributor, I know every store and broadcaster behaviour the SQLite driver has, the Postgres driver has too.

## Done when
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/driver-postgres/test/testkit.test.ts` runs `runStoreSuite` and `runBroadcasterSuite` whole, with the same number of cases as `bun test packages/driver-sqlite/test/testkit.test.ts`, and both pass
- [ ] `bun test packages/driver-sqlite` still passes after any change to the shared SQL

## Out of scope
- Concurrent writers on one board (164).
- `EXPLAIN` of statements no testkit case reaches (165); catalog parity (166).
- HTTP and isolation suites on Postgres (168).
- A broadcaster that wakes other instances (M6, 176).

## Notes
- Point `testkit.test.ts` at `runStoreSuite("postgres", open)` and `runBroadcasterSuite` from `@openboard/ports/testkit` (`packages/ports/testkit/index.ts`), `open` creating a fresh database from 162's template harness (`packages/driver-postgres/src/database.ts`).
- Expected engine differences to fix in the shared SQL, not around it (D32, data-model "The store port"): text ordering (Postgres sorts by the database collation, SQLite by bytes: channel paging and `after` comparisons on `path` need byte order on both, for example a `COLLATE "C"` fragment that renders to nothing on SQLite, like `forUpdate` in `packages/driver-sql/src/sql.ts`); `NULL` ordering (`NULLS FIRST` on SQLite, last on Postgres) in `channelMessagesAfter` (`packages/driver-sql/src/views/messages.ts`); parameter typing of `LIMIT $n` and of values bound as strings.
- A testkit case that encodes SQLite-only behaviour is fixed in `packages/ports/testkit/store/**` with the reason in the PR; a case is never removed or skipped for Postgres.
