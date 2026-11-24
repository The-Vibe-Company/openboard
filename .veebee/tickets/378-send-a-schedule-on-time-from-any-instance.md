---
id: 378
title: Send a schedule on time from any instance
milestone: M13-data-files-schedules
package: server
writes:
  - packages/contract/src/entities/messages.ts
  - packages/core/src/schedules/send.ts
  - packages/core/test/schedules/send.test.ts
  - packages/core/src/messages/post.ts
  - packages/core/src/index.ts
  - packages/ports/src/store.ts
  - packages/driver-sql/src/views/schedule-sends.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/driver-sql/src/statements.ts
  - packages/server/src/jobs/schedules.ts
  - packages/server/src/jobs/registry.ts
  - packages/server/test/ha/schedules.test.ts
conformance: []
modes: [local, hosted]
depends_on: [181, 373, 375, 377]
status: draft
claimed_by: null
issue: 573
---

## What the user does
As a person who scheduled a nudge, it posts in the thread when it is due, as me, exactly once, whichever instance is up at that moment.

## Done when
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/ha/schedules.test.ts` passes with both instances' runners polling on one fake clock: a schedule due at T posts one reply at T (not before), as its creator with the profile it was scheduled with, carrying `schedule: { id: "s1", n: 0 }`, its labels, `noSync` and attachments; the schedule reads `state: "done"`, `sent: 1`, `last` the reply's ID; a send picked by both instances posts once (the unique `(board_id, schedule_id, n)` key); `--every 1m --times 3` posts three replies at one-minute slots with `n` 0, 1, 2, then reads `done`
- [ ] the same file passes on SQLite (`bun test packages/server/test/ha/schedules.test.ts`); and in both modes a creator that can no longer post in the channel by then (grant revoked) gets the schedule canceled with reason `revoked` and nothing posted, and a reply schedule whose thread root was deleted is canceled with reason `thread_deleted`
- [ ] `ob serve`, `ob schedule 812 "ping" --in 30s`, then 30 s later `ob read 812` shows the reply marked `scheduled s1`

## Out of scope
- Sending once after downtime (379), though a send late by the poll interval is on time here.
- Waking a webhook from a send (381).

## Notes
- docs/architecture.md "Jobs any instance can take" (schedule sends: pick due rows with `FOR UPDATE SKIP LOCKED` in a short transaction that only picks, then a normal board write that re-checks `next_at` under the board lock, posts with the unique key, advances `next_at`), D24 and D36, `docs/01-board/07-schedules.md` "As whom" and "How it runs" (each send runs with its creator's access as it is when due; `revoked`; a reply schedule ends when its thread is deleted).
- The pick reads the `schedules_due` index (`packages/driver-sql/src/views/schedule-sends.ts`), so creating a schedule enqueues nothing and 376 and 380 can run beside this ticket without sharing a file; register the kind in `packages/server/src/jobs/registry.ts` (181) so every runner polls it each second.
- The send posts through core's post path with the creator resolved as stored (D46: the author as it was when written), then re-checked with `keepInsideCan` (`packages/server/src/auth/access.ts`) against the grants as they are now. The `message.posted` fold (`packages/driver-sql/src/views/messages.ts`) fills `messages.schedule_id`/`schedule_n` and advances the schedule's row in the same write; the message view gains upstream's `schedule: { id, n }` (`packages/contract/src/entities/messages.ts`).
- After each send the next slot comes from 377's `packages/core/src/schedules/timing.ts`. **Arrow added:** 377, so repeats are computed before the first send exists and the two do not change the schedule core in parallel.
- In local mode the runner is the SQLite jobs timer (181): the process must be running (D24), which the README already says for webhooks.
- Depends on 375 and 372, the last tickets before it to change `packages/core/src/index.ts` and `packages/server/src/jobs/registry.ts`.

Orchestrator note (2026-11-24): dropped file-ordering dependency on 372 (packages/server/src/jobs/registry.ts).
