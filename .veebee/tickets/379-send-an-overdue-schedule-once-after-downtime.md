---
id: 379
title: Send an overdue schedule once after downtime
milestone: M13-data-files-schedules
package: core
writes:
  - packages/core/src/schedules/send.ts
  - packages/core/src/schedules/timing.ts
  - packages/core/test/schedules/send.test.ts
  - packages/server/test/ha/schedules-downtime.test.ts
conformance: []
modes: [local, hosted]
depends_on: [378]
status: draft
claimed_by: null
issue: 574
---

## What the user does
As a person whose local board was off all weekend, my hourly reminder posts once when the board comes back, not 48 times.

## Done when
- [ ] `bun test packages/server/test/ha/schedules-downtime.test.ts` passes on SQLite: with `--every 1h` due at T, the board stopped at T − 1 min and started at T + 48 h posts one reply with `schedule.n: 0`, and its next slot is the first one after the restart, not T + 1 h; a one-off due during the downtime posts once on start
- [ ] the same file passes on Postgres with two instances (`OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard`): with every runner stopped for 48 h and both restarted together, one reply is posted; `--times 3` still counts sends, not slots, and `--until` already past at restart ends the schedule with no send

## Out of scope
- Replaying missed slots, which upstream refuses on purpose.

## Notes
- Upstream `docs/01-board/07-schedules.md` "How it runs" ("Downtime doesn't replay: the next send is the next slot after now, so a board that was down sends once rather than catching up on every missed slot"), D24 ("overdue schedules send once"). The next slot is computed from now in `packages/core/src/schedules/timing.ts` (377) and `send.ts` (378): this ticket fixes whichever of them counts from the previous slot instead, with the clock from `deps`.
- Depends on 378, which last changes `send.ts` (after 377 changed `timing.ts`).
