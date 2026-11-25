---
id: 374
title: List a thread's schedules
milestone: M13-data-files-schedules
package: server
writes:
  - docs/decisions.md
  - docs/protocol.md
  - packages/cli/src/commands/index.ts
  - packages/cli/src/commands/read.ts
  - packages/cli/src/commands/schedule/index.ts
  - packages/cli/src/commands/usage.ts
  - packages/cli/test/schedule.test.ts
  - packages/contract/src/operations/schedules/index.ts
  - packages/contract/src/operations/threads.ts
  - packages/core/src/messages/mentions.ts
  - packages/core/src/messages/post.ts
  - packages/driver-postgres/src/catalog.ts
  - packages/driver-sql/migrations/0055-schedule-thread-index.sql
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/purge-test-data.ts
  - packages/driver-sql/src/views/schedules/index.ts
  - packages/driver-sql/src/views/threads.ts
  - packages/driver-sqlite/src/catalog.ts
  - packages/ports/src/board-message-reads.ts
  - packages/ports/src/store.ts
  - packages/ports/testkit/isolation-case-seeds.ts
  - packages/ports/testkit/isolation.test-suite.ts
  - packages/ports/testkit/store/messages.test-suite.ts
  - packages/ports/testkit/store/threads.test-suite.ts
  - packages/server/openapi.json
  - packages/server/src/operations/index.ts
  - packages/server/src/operations/schedules/index.ts
  - packages/server/src/operations/threads.ts
  - packages/server/test/isolation/seed.ts
  - packages/server/test/messages.test.ts
  - packages/server/test/schedules/create.test.ts
  - packages/server/test/schedules/list.test.ts
  - packages/server/test/threads.test.ts
  - skills/openboard/references/commands.md
  - tools/conformance/score.json
conformance: []
modes: [local, hosted]
depends_on: [373]
status: done
claimed_by: codex-t374
issue: 569
---

## What the user does
As a person reading a thread, I see what is scheduled to post in it, and `ob schedules 812` lists those schedules alone.

## Done when
- [x] after two schedules in thread 812 and one in `dev`, `ob schedules 812` prints the two, oldest first, in upstream's one-line form; `ob schedules` prints all three; `ob read 812` prints the thread with its pending schedules under it, and `ob read 812 --json` has `schedules` beside `message`, `replies` and `cursor`
- [x] `bun test packages/server/test/schedules/list.test.ts` passes on SQLite and Postgres: `GET /schedules` filters by `re` (any message of the thread), `channel`, `by` (actor ID or handle) and `all` (done and canceled too, else pending only); a caller sees only schedules in channels it reads, except that a creator that cannot read the channel still lists the ones it made there; another organization's schedules never appear in `GET /schedules` or in a thread read's `schedules`

## Out of scope
- Canceling (375); sending (378).

## Notes
- The cross-organization 404 `schedule_not_found` assertion belongs to ticket 375 (#570), which implements the cancel route that accepts a schedule ID.
- Upstream `GET /schedules` (`{ schedules }`, query `re`, `channel`, `by`, `all`) and `GET /messages/:id` (`{ message, replies, cursor, schedules }`), `docs/01-board/07-schedules.md` "Listing and canceling" (pending, oldest first; `--all` for the rest; a creator that cannot read lists only its own there).
- The thread read lives in `packages/server/src/operations/threads.ts`; it adds one indexed read of the thread's pending schedules. Check with `bun run bench --quick` that the thread read's statement count changes only by that one and update the counter in the PR if it does (raising a budget is the owner's call; a counter that rises because a read now answers more is stated in the PR).
