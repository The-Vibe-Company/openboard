---
id: 395
title: Sweep expired operational rows
milestone: M15-operations
package: server
writes:
  - packages/server/src/jobs/sweep.ts
  - packages/server/src/jobs/registry.ts
  - packages/server/test/ha/sweep.test.ts
  - packages/server/test/ha/purge-org.test.ts
  - packages/driver-sql/src/views/jobs/sweep.ts
  - packages/driver-sql/src/statements.ts
  - packages/ports/src/store.ts
  - packages/driver-sql/migrations/0040-operational-retention.sql
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/sweep-test-data.ts
  - packages/driver-postgres/src/catalog.ts
  - packages/driver-sqlite/src/catalog.ts
  - packages/server/src/app.ts
  - packages/server/src/jobs/export-org.ts
  - packages/cli/src/commands/derived.ts
  - packages/cli/src/commands/index.ts
  - packages/cli/src/main.ts
  - packages/cli/test/webhooks.test.ts
  - packages/contract/src/operations/webhooks/deliveries.ts
  - packages/server/openapi.json
  - skills/openboard/references/commands.md
  - docs/architecture.md
  - docs/data-model.md
  - docs/decisions.md
  - docs/protocol.md
conformance: []
modes: [local, hosted]
depends_on: [181, 300, 304, 333, 392]
status: done
claimed_by: codex-t395
issue: 590
---

## What the user does
As the operator, I want finished operational rows to expire so storage stays bounded, with seven days of done and skipped delivery history and 30 days to inspect and retry dead deliveries.

## Done when
- [x] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/ha/sweep.test.ts` passes with both runners polling on a fake clock: `done` and `skipped` webhook deliveries and `inbound_seen` rows older than 7 days, `done` watcher matches older than 1 day, expired sessions and device codes, and accepted or expired invitations older than 90 days are deleted, each by exactly one runner, in batches of at most 1,000 rows per statement; `dead` deliveries older than 30 days are also deleted, pending deliveries and everything younger stay, and a swept history cursor returns `{ deliveries: [], older: null }`
- [x] the same file passes on SQLite (`bun test packages/server/test/ha/sweep.test.ts`); an inbound event replayed after its `inbound_seen` row was swept is treated as new, which the test states; and `bun run bench --quick` reports zero timers armed when idle

- [x] `bun run ob -- webhooks deliveries --help` shows the seven-day done/skipped and 30-day dead-delivery windows.

## Out of scope
- The event log, which is never swept (398 is its policy); blobs (372); organizations (208).

## Notes
- docs/data-model.md "Operational tables (not replayed)" ("Retention (job): done/skipped deliveries and `inbound_seen` after 7 days, done matches after 1 day, expired sessions and device codes, accepted or expired invitations after 90 days"), docs/architecture.md "Jobs any instance can take" (retention: same pick pattern, idempotent).
- Sweep on due-job activity through the existing runner, with no recurring wake (issue #590); every statement in `packages/driver-sql/src/views/jobs/sweep.ts` uses an index (the `EXPLAIN` registry, 165) and filters on a tenant key or is listed as platform-wide in the registry's scope check, as `deliveries_due` is.
- **Arrows added:** 300 (`watcher_matches`), 304 (`webhook_deliveries`) and 333 (`inbound_seen`), which create the tables it sweeps.
- Depends on 392, the last ticket before it to change `packages/server/src/jobs/registry.ts`.
