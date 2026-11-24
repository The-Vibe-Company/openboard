---
id: 405
title: Carry the organization on every board row
milestone: M15-operations
package: driver-sql
writes:
  - packages/driver-sql/migrations/*-org-on-board-rows.sql
  - packages/driver-sql/src/views/grants.ts
  - packages/driver-sql/src/views/connections.ts
  - packages/driver-sql/src/views/agents.ts
  - packages/ports/testkit/isolation.test-suite.ts
  - scripts/ci/migrations.ts
  - scripts/ci/migrations.test.ts
  - docs/data-model.md
conformance: []
modes: [local, hosted]
depends_on: []
status: draft
claimed_by: null
issue: null
---

## What the user does
As the operator, every row that belongs to a board also names its organization, so a tenancy policy (row-level security) can be added later without a schema change, as docs/data-model.md promises.

## Done when
- [ ] after migrating, `grant_principals` and `task_needs` have an `org_id` column filled for every existing row (from `boards`), and every statement on `grant_principals` filters on `org_id` and `board_id`; `bun test packages/ports/testkit` passes on SQLite and on Postgres (`OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard`), with an isolation case reading a grant principal under another organization's keys and getting nothing
- [ ] `bun run lint` fails when a new migration creates a table with `board_id` and no `org_id` (a rule in `scripts/ci/migrations.ts`, tested in `scripts/ci/migrations.test.ts`), and passes on main

## Out of scope
- Making the new columns `NOT NULL`: that is the contract phase, a later release (docs/codebase.md 7.6, marked `-- contract-phase`).
- Row-level security itself (D56 keeps it off in v1).

## Notes
Found reviewing #722 (2026-11-24): `grant_principals` (0002) and `task_needs` (0012) carry only `board_id`. No query leaks today, since every statement also filters by board, but the rule in docs/data-model.md ("every board-scoped row carries `org_id` and `board_id`") is what lets RLS come later without a schema change. Expand only: add the column nullable, backfill in the same migration (the tables are small), write `org_id` on every insert. `task_needs` has no reader or writer yet. Use the next free migration number when you open the PR, and rebase if another migration lands first.
