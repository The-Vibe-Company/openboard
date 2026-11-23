---
id: 180
title: Survive the kill-the-database drill without losing a write
milestone: M6-high-availability
package: server
writes:
  - packages/server/test/ha/drill.test.ts
  - packages/server/test/support/drivers.ts
conformance: []
modes: [hosted]
depends_on: [172, 177, 179]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an agent using a hosted board, when the database restarts mid-traffic I get fast retryable errors, and nothing the board acknowledged is lost or skipped.

## Done when
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/ha/drill.test.ts` passes: while posts go through both instances and a long-poll and an SSE stream follow the channel, every backend connection is terminated; requests during the outage answer 503 `unavailable` within 3 s, the stream stays open, and afterwards every post that was answered 2xx appears exactly once, in order, in the stream and in a channel read

## Out of scope
- `/readyz` during the outage (184).
- Killing the Postgres container during the conformance run (docs/architecture.md "Upgrade path"): this drill is the CI form docs/codebase.md 6.4 names; the container form is not planned.
- A failover that loses commits (185).

## Notes
- docs/codebase.md 6.4 (first bullet of `packages/server/test/ha/*.test.ts`), D38, docs/architecture.md "Availability and failures" (database restart row). The first case under `packages/server/test/ha/`.
- Terminating backends is SQL: the test reaches 178's helper in `packages/driver-postgres/src/database.ts` through `packages/server/test/support/drivers.ts`, the composition root tests may use.
- Writes the test retries carry a post `id`, so a retry after an ambiguous failure is idempotent (docs/architecture.md "Upgrade path": no server-side retry without an idempotency key); a 2xx counts as acknowledged.
- The PR states the drill's wall time; it must stay under one second (AGENTS.md "Tests").
