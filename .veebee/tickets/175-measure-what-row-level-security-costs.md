---
id: 175
title: Measure what row-level security costs
milestone: M5-postgres-driver
package: driver-postgres
writes:
  - packages/driver-postgres/bench/rls.ts
  - docs/decisions.md
  - docs/data-model.md
  - packages/driver-postgres/test/support/env.ts
  - packages/driver-postgres/tsconfig.json
conformance: []
modes: [hosted]
depends_on: [173]
status: claimed
claimed_by: claude-t175
issue: 255
---

## What the user does
As the owner, I decide whether hosted mode turns on Postgres row-level security knowing what it costs per read and per write.

## Done when
- [ ] `OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun packages/driver-postgres/bench/rls.ts` seeds a fresh database with the bench workload, then prints p50 and p99 of a channel read and of a post, and round trips per operation, with and without RLS policies (`org_id = current_setting('app.org_id')::bigint`) and the tenant set per transaction
- [ ] `docs/decisions.md` has a new decision record with those numbers, the database and machine they were taken on, and a recommendation; docs/data-model.md "Tenancy" points to it

## Out of scope
- Turning RLS on: a later ticket, only if the owner decides so.
- Changing the tenant isolation suites (135, 168).

## Notes
- M5 in docs/project.md; docs/data-model.md "Tenancy" (RLS kept as a seam; it costs a round trip on every read because reads are single statements); D33.
- Policies and `set_config` are SQL, so the measurement lives in this driver's workspace, outside `src/` and its exports, so nothing ships with it. Create the policies on the scratch database only: no migration.
- Read the database URL through `packages/driver-postgres/test/support/env.ts` (the one file the lint override of 162 lets read `OPENBOARD_TEST_*`); never take it as an argument.
- The decision is the owner's: the record states the measurement and a recommendation, and the PR asks for the choice.
