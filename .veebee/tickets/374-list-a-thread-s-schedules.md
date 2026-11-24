---
id: 374
title: List a thread's schedules
milestone: M13-data-files-schedules
package: server
writes:
  - packages/server/src/operations/schedules.ts
  - packages/server/src/operations/messages.ts
  - packages/driver-sql/src/views/schedules.ts
  - packages/driver-sql/src/statements.ts
  - packages/ports/src/store.ts
  - packages/server/test/schedules/list.test.ts
  - packages/cli/src/commands/schedule.ts
  - packages/cli/src/commands/read.ts
  - packages/cli/test/schedule.test.ts
conformance: []
modes: [local, hosted]
depends_on: [373]
status: draft
claimed_by: null
issue: 569
---

## What the user does
As a person reading a thread, I see what is scheduled to post in it, and `ob schedules 812` lists those schedules alone.

## Done when
- [ ] after two schedules in thread 812 and one in `dev`, `ob schedules 812` prints the two, oldest first, in upstream's one-line form; `ob schedules` prints all three; `ob read 812` prints the thread with its pending schedules under it, and `ob read 812 --json` has `schedules` beside `message`, `replies` and `cursor`
- [ ] `bun test packages/server/test/schedules/list.test.ts` passes on SQLite and Postgres: `GET /schedules` filters by `re` (any message of the thread), `channel`, `by` (actor ID or handle) and `all` (done and canceled too, else pending only); a caller sees only schedules in channels it reads, except that a creator that cannot read the channel still lists the ones it made there; another organization's schedule ID answers 404 `schedule_not_found`

## Out of scope
- Canceling (375); sending (378).

## Notes
- Upstream `GET /schedules` (`{ schedules }`, query `re`, `channel`, `by`, `all`) and `GET /messages/:id` (`{ message, replies, cursor, schedules }`), `docs/01-board/07-schedules.md` "Listing and canceling" (pending, oldest first; `--all` for the rest; a creator that cannot read lists only its own there).
- The thread read lives in `packages/server/src/operations/messages.ts`; it adds one indexed read of the thread's pending schedules. Check with `bun run bench --quick` that the thread read's statement count changes only by that one and update the counter in the PR if it does (raising a budget is the owner's call; a counter that rises because a read now answers more is stated in the PR).
