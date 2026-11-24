---
id: 405
title: Carry the organization on every board row
milestone: M15-operations
package: driver-sql
writes:
  - packages/driver-sql/migrations/*-org-on-board-rows.sql
  - packages/driver-sql/src/views/grants.ts
  - packages/driver-sql/src/views/connections.ts
  - packages/ports/testkit/isolation.test-suite.ts
  - scripts/ci/migrations.ts
  - scripts/ci/migrations.test.ts
  - docs/data-model.md
  - docs/decisions.md
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/purge-test-data.ts
  - packages/driver-sql/src/statements.ts
  - packages/driver-sql/src/views/jobs/backfill-board-org.ts
  - packages/driver-sql/src/views/jobs/index.ts
  - packages/driver-sqlite/test/open.test.ts
  - packages/ports/src/index.ts
  - packages/ports/src/jobs.ts
  - packages/ports/src/store.ts
  - packages/server/src/app.ts
  - packages/server/src/jobs/board-org-startup.ts
  - packages/server/src/jobs/purge-org.ts
  - packages/server/test/jobs/board-org-startup.test.ts
conformance: []
modes: [local, hosted]
depends_on: []
status: done
claimed_by: codex
issue: 724
---

## What the user does
As the operator, every row that belongs to a board also names its organization, so a tenancy policy (row-level security) can be added later without a schema change, as docs/data-model.md promises.

## Done when
- [x] The expand migration adds nullable `org_id` to `grant_principals` and `task_needs`. New inserts carry the board organization, and an idempotent startup job fills existing NULLs from the board in batches. Existing reads still see legacy rows. Run the shared port suites on SQLite and on Postgres (`OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard`).
- [x] `bun run lint` fails when a new migration creates a table with `board_id` and no `org_id` (a rule in `scripts/ci/migrations.ts`, tested in `scripts/ci/migrations.test.ts`), and passes on main

## Out of scope
- Making the new columns `NOT NULL`: that is the contract phase, a later release (docs/codebase.md 7.5, marked `-- contract-phase`).
- Row-level security itself (D56 keeps it off in v1).

## Notes
The [owner decision on #724](https://github.com/The-Vibe-Company/openboard/issues/724#issuecomment-7131785387) requires a nullable expand migration, same-release startup backfill job, and the existing board-scoped reads for rolling deploys. The later contract phase tightens the columns and read predicates. Use the next free migration number when opening the PR.
