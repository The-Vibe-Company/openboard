---
id: 181
title: Run each due job on exactly one instance
milestone: M6-high-availability
package: ports
writes:
  - packages/ports/src/jobs.ts
  - packages/ports/src/index.ts
  - packages/ports/testkit/jobs.test-suite.ts
  - packages/ports/testkit/index.ts
  - packages/driver-sql/migrations/*-jobs.sql
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/statements.ts
  - packages/driver-sql/src/views/jobs.ts
  - packages/driver-sqlite/src/jobs.ts
  - packages/driver-sqlite/src/index.ts
  - packages/driver-sqlite/test/testkit.test.ts
  - packages/driver-postgres/src/jobs.ts
  - packages/driver-postgres/src/index.ts
  - packages/driver-postgres/test/testkit.test.ts
  - packages/server/src/jobs/registry.ts
  - packages/server/src/app.ts
  - packages/server/src/index.ts
  - packages/server/test/ha/jobs.test.ts
  - packages/server/test/support/drivers.ts
  - apps/openboard/src/compose.ts
  - tools/conformance/src/drivers.ts
  - tools/bench/src/drivers.ts
conformance: []
modes: [local, hosted]
depends_on: [177, 180]
status: draft
claimed_by: null
issue: null
---

## What the user does
As the operator of a hosted board, work due later runs once, on whichever instance is free, even with several instances polling.

## Done when
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/ha/jobs.test.ts` passes: twenty jobs enqueued in board writes through instance 1 each run exactly once when both instances' runners poll, and a job whose lease expired on an instance that stopped is run by the other
- [ ] `bun test packages/driver-sqlite/test/testkit.test.ts` and the Postgres testkit run (`OPENBOARD_TEST_DRIVER=postgres … bun test packages/driver-postgres/test/testkit.test.ts`) pass `runJobsSuite`

## Out of scope
- Any production job kind: schedule sends (M13, 378), webhook deliveries (M11), hard deletion, log shipping and dumps (M7, 208, 210, 211) each register their own.
- Releasing leases on `SIGTERM` (183).

## Notes
- docs/architecture.md "Jobs any instance can take", D36, docs/codebase.md 2.2 (`ports/src/jobs.ts`: `enqueue(kind, dueAt, payload)` inside a write; `claim(kinds, instanceId)` -> leased job) and 5.6. Postgres picks with `FOR UPDATE SKIP LOCKED` in a short transaction that only picks and leases; the effect then runs as a normal board write keyed so a duplicate pick does nothing. Lock order stays "board row first": the picker releases its rows before taking a board lock (docs/data-model.md "Per-board serialization").
- SQLite: a jobs table and one timer to the next due job (docs/codebase.md 2.2 `driver-sqlite/src/jobs.ts`); timers come from the driver, never from server code.
- Each instance polls due work every second and wakes on `NOTIFY ob_jobs` for work due within a second; the runner's clock and timer come from `deps`, so the test advances them. `OPENBOARD_INSTANCE_ID` (docs/codebase.md 5.5) names the lease holder.
- The test registers a test-only kind; the migration (next free number, `packages/driver-sql/migrations/`) and the hand-written `migrations` list in `packages/driver-sql/src/index.ts` follow the rules of `scripts/ci/migrations.ts`. Every composition root passes the new port to `createApp`.
- A new job kind is handled by the release before the one that enqueues it (docs/codebase.md 5.7).
- Depends on 180 because both change `packages/server/test/support/drivers.ts`.
