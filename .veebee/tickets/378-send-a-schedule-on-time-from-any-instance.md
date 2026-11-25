---
id: 378
title: Send a schedule on time from any instance
milestone: M13-data-files-schedules
package: server
writes:
  - docs/architecture.md
  - docs/data-model.md
  - docs/decisions.md
  - docs/protocol.md
  - packages/cli/src/output.ts
  - packages/contract/src/entities/events.ts
  - packages/contract/src/entities/messages.ts
  - packages/core/src/index.ts
  - packages/core/src/messages/post.ts
  - packages/core/src/schedules/send.ts
  - packages/driver-postgres/src/jobs.ts
  - packages/driver-sql/migrations/0057-schedule-send-jobs.sql
  - packages/driver-sql/migrations/0058-schedule-send-backfill.sql
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/views/actors.ts
  - packages/driver-sql/src/views/jobs/index.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/driver-sql/src/views/messages/post-fold.ts
  - packages/driver-sql/src/views/messages/statements.ts
  - packages/driver-sql/src/views/schedules/index.ts
  - packages/driver-sql/src/views/schedules/send.ts
  - packages/driver-sqlite/src/ddl.ts
  - packages/driver-sqlite/src/jobs.ts
  - packages/driver-sqlite/src/open.ts
  - packages/driver-sqlite/test/schedule-migration.test.ts
  - packages/ports/src/index.ts
  - packages/ports/src/jobs.ts
  - packages/ports/src/store.ts
  - packages/ports/testkit/isolation-case-seeds.ts
  - packages/ports/testkit/isolation.test-suite.ts
  - packages/ports/testkit/store/schedules.test-suite.ts
  - packages/server/openapi.json
  - packages/server/src/app.ts
  - packages/server/src/auth/access.ts
  - packages/server/src/jobs/registry.ts
  - packages/server/src/jobs/schedules.ts
  - packages/server/src/operations/events.ts
  - packages/server/test/ha/purge-org.test.ts
  - packages/server/test/ha/schedules.test.ts
  - packages/server/test/isolation/seed.ts
  - skills/openboard/SKILL.md
conformance: []
modes: [local, hosted]
depends_on: [181, 373, 375, 377]
status: done
claimed_by: codex
issue: 573
---

## What the user does
As a person who scheduled a nudge, it posts in the thread when it is due, as me, exactly once, whichever instance is up at that moment.

## Done when
- [x] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/ha/schedules.test.ts` passes with both instances' runners waking at the due time on one fake clock: a schedule due at T posts one reply at T (not before), as its creator with the profile it was scheduled with, carrying `schedule: { id: "s1", n: 0 }`, its labels, `noSync` and attachments; the schedule reads `state: "done"`, `sent: 1`, `last` the reply's ID; a send picked by both instances posts once (the unique `(board_id, schedule_id, n)` key); `--every 1m --times 3` posts three replies at one-minute slots with `n` 0, 1, 2, then reads `done`
- [x] the same file passes on SQLite (`bun test packages/server/test/ha/schedules.test.ts`); and in both modes a creator that can no longer post in the channel by then (grant revoked) gets the schedule canceled with reason `revoked` and nothing posted, and a reply schedule whose thread root was deleted is canceled with reason `thread_deleted`
- [x] `ob serve`, `ob schedule 812 "ping" --in 30s`, then 30 s later `ob read 812` shows the reply marked `scheduled s1`

## Out of scope
- Sending once after downtime (379), though a send late by the poll interval is on time here.
- Waking a webhook from a send (381).

## Notes
- Decision on #573: use transactional schedule-send jobs with due-time wakeups (D36), following task expiry. Enqueue at creation and each repeat advance, and remove on cancellation. Picking uses the existing Jobs queue, and idle runners arm no timer. The board write rechecks schedule state, slot, and due time before posting.
- The migration queues existing pending schedules and uses row triggers so older Postgres replicas also enqueue during rollout. SQLite wakes its runner after commit.
- Each send uses the creator's current grants; a revoked creator cancels as `revoked`, and a deleted thread root cancels as `thread_deleted`.
- The send posts through core's post path with the creator resolved as stored (D46: the author as it was when written), then re-checked with `keepInsideCan` (`packages/server/src/auth/access.ts`) against the grants as they are now. The `message.posted` fold (`packages/driver-sql/src/views/messages/post-fold.ts`) fills `messages.schedule_id`/`schedule_n` and advances the schedule's row in the same write; the message view gains upstream's `schedule: { id, n }` (`packages/contract/src/entities/messages.ts`).
- After each send the next slot comes from 377's `packages/core/src/schedules/timing.ts`. **Arrow added:** 377, so repeats are computed before the first send exists and the two do not change the schedule core in parallel.
- In local mode the runner is the due-time SQLite jobs timer (181): the process must be running (D24), which the README already says for webhooks.
- Depends on 375 and 372, the last tickets before it to change `packages/core/src/index.ts` and `packages/server/src/jobs/registry.ts`.

Orchestrator note (2026-11-24): dropped file-ordering dependency on 372 (packages/server/src/jobs/registry.ts).
