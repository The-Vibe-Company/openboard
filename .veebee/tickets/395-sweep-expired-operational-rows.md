---
id: 395
title: Sweep expired operational rows
milestone: M15-operations
package: server
writes:
  - packages/server/src/jobs/sweep.ts
  - packages/server/src/jobs/registry.ts
  - packages/server/test/ha/sweep.test.ts
  - packages/driver-sql/src/views/sweep.ts
  - packages/driver-sql/src/statements.ts
  - packages/ports/src/store.ts
conformance: []
modes: [local, hosted]
depends_on: [181, 300, 304, 333, 392]
status: draft
claimed_by: null
issue: 590
---

## What the user does
As the operator, tables of finished work (deliveries, matches, seen inbound events, expired sessions and device codes, old invitations) stop growing forever, without touching anything a tenant can still read or retry.

## Done when
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/ha/sweep.test.ts` passes with both runners polling on a fake clock: `done` and `skipped` webhook deliveries and `inbound_seen` rows older than 7 days, `done` watcher matches older than 1 day, expired sessions and device codes, and accepted or expired invitations older than 90 days are deleted, each by exactly one runner, in batches of at most 1,000 rows per statement; `dead` deliveries, pending ones, and everything younger stay
- [ ] the same file passes on SQLite (`bun test packages/server/test/ha/sweep.test.ts`); an inbound event replayed after its `inbound_seen` row was swept is treated as new, which the test states; and `bun run bench --quick` shows no timer armed while idle beyond the jobs runner's

## Out of scope
- The event log, which is never swept (398 is its policy); blobs (372); organizations (208).

## Notes
- docs/data-model.md "Operational tables (not replayed)" ("Retention (job): done/skipped deliveries and `inbound_seen` after 7 days, done matches after 1 day, expired sessions and device codes, accepted or expired invitations after 90 days"), docs/architecture.md "Jobs any instance can take" (retention: same pick pattern, idempotent).
- One recurring kind in `packages/server/src/jobs/registry.ts`; every statement in `packages/driver-sql/src/views/sweep.ts` uses an index (the `EXPLAIN` registry, 165) and filters on a tenant key or is listed as platform-wide in the registry's scope check, as `deliveries_due` is.
- **Arrows added:** 300 (`watcher_matches`), 304 (`webhook_deliveries`) and 333 (`inbound_seen`), which create the tables it sweeps.
- Depends on 392, the last ticket before it to change `packages/server/src/jobs/registry.ts`.
