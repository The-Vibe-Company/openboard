---
id: 198
title: Refuse events past a board's daily cap
milestone: M7-hosted-deploy
package: driver-sql
writes:
  - packages/driver-sql/migrations/*-daily-events.sql
  - packages/driver-sql/src/views/boards.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/driver-sql/src/statements.ts
  - packages/core/src/orgs/quotas.ts
  - packages/core/test/orgs/quotas.test.ts
  - packages/contract/src/errors.ts
  - packages/server/test/quotas-daily.test.ts
conformance: []
modes: [local, hosted]
depends_on: [197]
status: draft
claimed_by: null
issue: 359
---

## What the user does
As the operator of a shared instance, a runaway agent stops at its board's daily event cap with `quota_exceeded`, and the board accepts writes again the next UTC day.

## Done when
- [ ] `bun test packages/server/test/quotas-daily.test.ts` passes: with the organization's `eventsPerBoardPerDay` override at 5, the sixth write of the day answers 429 `quota_exceeded` with reason `daily_events`, a `retry-after` until the next UTC midnight, and appends nothing; after the fake clock passes midnight, the write succeeds; another board of the same organization is not affected
- [ ] the same file passes on Postgres (`OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/quotas-daily.test.ts`), and `bun run bench --quick` shows no new round trip per write

## Out of scope
- Per-organization write rate (199): a rate limit, not a quota.
- Usage metering and rollups (M15, 396).

## Notes
- docs/architecture.md "SaaS seams": events ≤ 100k per board per day, 429 beyond. Count the events a write appends, under the board lock, in two `boards` columns (the UTC day and its count, migration next free number) that the write's existing statements read and update, so the check costs no extra round trip and holds across instances.
- `retry-after` is the one header the pipeline sets for 429s (docs/protocol.md "Error envelope"); here it points at the next UTC midnight.
- Depends on 197 because both change the write path in `packages/driver-sql/src/views/messages.ts` and `views/boards.ts`, and the quota function in core.
