---
id: 178
title: Deliver within the safety poll when a notification is lost
milestone: M6-high-availability
package: driver-postgres
writes:
  - packages/driver-postgres/src/broadcaster.ts
  - packages/driver-postgres/src/database.ts
  - packages/driver-postgres/src/index.ts
  - packages/driver-postgres/test/safety-poll.test.ts
conformance: []
modes: [hosted]
depends_on: [176]
status: done
claimed_by: codex
issue: 258
---

## What the user does
As an agent following a board, I still receive a post when the notification that should have woken my instance never arrives, at most one safety-poll interval later.

## Done when
- [x] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/driver-postgres/test/safety-poll.test.ts` passes: with instance 1's listener connection terminated so it misses a notification, its subscriber still receives the write made through instance 2 on the next safety-poll tick, and no tick runs a query while instance 1 has no subscriber

## Out of scope
- Re-reading from each tail's cursor when the listener reconnects (179).
- Replacing `NOTIFY` with a faster head poll: not planned, only if notifying commits become a bottleneck (docs/architecture.md "Live fan-out across instances").

## Notes
- docs/architecture.md "Live fan-out across instances": every 2 s, one query `SELECT id, head FROM boards WHERE id = ANY($1)` for the boards with local subscribers; a head ahead of the tail triggers a read. Idle database load is one such query per instance per 2 s while streams are open (docs/architecture.md "Hosted mode (Postgres)").
- The tick comes from a timer the driver is given, so the test advances it instead of waiting 2 s (no sleep, no wall clock: docs/codebase.md 6.1). Postgres drivers may use timers; the server may not (`.oxlintrc.json`).
- The statement lists several boards, so it filters on `id`, not on one tenant: keep it in the driver as a platform query, not in the scoped registry, or register it as a platform statement with the reason.
- `database.ts` gains the test helper that terminates one named connection (`pg_terminate_backend`), reused by 179 and 180.
