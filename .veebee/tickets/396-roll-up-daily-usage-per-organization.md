---
id: 396
title: Roll up daily usage per organization
milestone: M15-operations
package: server
writes:
  - apps/openboard/src/compose.ts
  - docs/data-model.md
  - packages/driver-postgres/test/usage-rollout.test.ts
  - packages/driver-sql/migrations/*-usage.sql
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/statements.ts
  - packages/driver-sql/src/views/jobs/usage.ts
  - packages/driver-sql/src/views/jobs/purge.ts
  - packages/driver-sql/src/sweep-test-data.ts
  - packages/driver-sql/src/views/jobs/sweep.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/driver-sql/src/views/webhooks/deliveries.ts
  - packages/driver-sqlite/src/ddl.ts
  - packages/ports/src/index.ts
  - packages/ports/src/jobs.ts
  - packages/ports/src/store.ts
  - packages/ports/testkit/isolation.test-suite.ts
  - packages/server/src/index.ts
  - packages/server/src/jobs/usage.ts
  - packages/server/test/ha/purge-org.test.ts
  - packages/server/test/ha/usage.test.ts
conformance: []
modes: [local, hosted]
depends_on: [181, 304, 395]
status: done
claimed_by: codex
issue: 591
---

## What the user does
As the owner, I have each organization's daily events, stored bytes, webhook deliveries and active agents in one table, so later billing or abuse checks read numbers instead of scanning logs.

## Done when
- [x] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/ha/usage.test.ts` passes with both runners polling: after a UTC day with 40 events on two boards of organization A, 3 deliveries and 2 agents that wrote, `usage_daily` holds one row `(A, day, events 40, bytes_stored, deliveries 3, active_agents 2)` written by one runner; a day missed while runners were down is rolled up when they return, a day already rolled up is not counted twice, and B's row counts only B
- [x] the same file passes on SQLite, and the organization's purge (208) removes its `usage_daily` rows

## Out of scope
- Billing (out of scope, D40); showing usage to tenants; reading it from `openboard admin` (399 may add a command once this exists).
- The `Meter` port's per-request metering (docs/codebase.md 4.5 pipeline step 8).

## Notes
- The owner clarified on #591 that this lands after the v1 cut. See docs/architecture.md “SaaS seams” for the rollup design and docs/codebase.md §4.5 for release scope.
- Count from what is already stored: events by `at` per board (`events` index on board and position, never a full scan per day), `boards.stored_bytes` (197) at rollup time, `webhook_deliveries` by `created_at` (304), and distinct principals of agents (`ob:conn:…+profile`) among the day's events.
- **Arrow added:** 304, which creates `webhook_deliveries`.
- Depends on 395 for the delivery retention sweep.
