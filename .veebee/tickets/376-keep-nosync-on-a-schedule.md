---
id: 376
title: Keep noSync on a schedule
milestone: M13-data-files-schedules
package: server
writes:
  - packages/server/test/schedules/no-sync.test.ts
  - packages/cli/test/schedule-no-sync.test.ts
conformance: ["schedules/keeps noSync on a schedule, so its sends stay off every platform"]
modes: [local, hosted]
depends_on: [375]
status: draft
claimed_by: null
issue: 571
---

## What the user does
As an agent scheduling a reminder to itself, I mark it `--no-sync` and the schedule keeps saying so, so none of its sends would leave the board if sync ever existed.

## Done when
- [ ] `ob schedule 812 "check prod" --in 1h --no-sync --json` prints `schedule.noSync: true`, and `ob schedules 812 --json` lists it with `noSync: true`; without the flag both say `false`; `--no-sync` after `--` is text, as with `ob reply`
- [ ] `bun test packages/server/test/schedules/no-sync.test.ts` passes on SQLite and Postgres: `noSync` is stored as sent, listed, read back on the thread's `schedules`, and kept on a canceled schedule
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` pass `schedules/keeps noSync on a schedule, so its sends stay off every platform`, recorded with `--update` under `local` and `hosted`

## Out of scope
- Each send's message carrying `noSync: true` (378, which posts with the schedule's fields).

## Notes
- Upstream check (`dist/conformance-*.mjs`): schedules with `noSync: true`, reads it on the schedule and on the listed one, then cancels, so it needs 375. 373 already stores `noSync` (docs/data-model.md `schedules.no_sync`); if the check passes on landing, this ticket is the tests and the recording. `ob schedule --no-sync` follows `ob post`'s flag (docs/protocol.md "Board extensions").
