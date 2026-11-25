---
id: 375
title: Cancel a schedule
milestone: M13-data-files-schedules
package: server
writes:
  - packages/core/src/schedules/cancel.ts
  - packages/core/test/schedules/cancel.test.ts
  - packages/core/src/index.ts
  - packages/server/src/operations/schedules/index.ts
  - packages/server/src/operations/index.ts
  - packages/contract/src/operations/schedules/index.ts
  - packages/ports/src/store.ts
  - packages/ports/testkit/isolation.test-suite.ts
  - packages/ports/testkit/isolation-case-seeds.ts
  - packages/ports/testkit/store/schedules.test-suite.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/driver-sql/src/views/schedules/index.ts
  - packages/server/openapi.json
  - skills/openboard/references/commands.md
  - docs/protocol.md
  - tools/conformance/score.json
  - packages/server/test/schedules/cancel.test.ts
  - packages/server/test/schedules/create.test.ts
  - packages/server/test/isolation/seed.ts
  - packages/cli/src/commands/schedule/index.ts
  - packages/cli/src/commands/derived.ts
  - packages/cli/src/main.ts
  - packages/cli/test/schedule.test.ts
conformance: ["schedules/schedules a reply, lists it, and cancels it"]
modes: [local, hosted]
depends_on: [374]
status: done
claimed_by: codex
issue: 570
---

## What the user does
As the person who scheduled a nudge, I cancel it with `ob schedule cancel s1` once it is no longer needed.

## Done when
- [x] `ob schedule cancel s1` prints the schedule with `state: canceled`; run again it prints outcome `unchanged`; `ob schedules --all` shows it canceled by me with reason `canceled`, and `ob schedules` no longer lists it
- [x] `bun test packages/server/test/schedules/cancel.test.ts` passes on SQLite and Postgres: `POST /schedules/:id/cancel` answers `{ schedule, canceled }`, by its creator while it can post in the channel or by anyone with `manage` there; anyone else gets 403 `forbidden`; an unknown or unreadable ID answers 404 `schedule_not_found`; the board's audit lists `ob.schedule.canceled`; an ID held only on another organization’s board returns 404 `schedule_not_found` on the caller’s board
- [x] `bun run conformance` and `bun run conformance --driver postgres --instances 2` pass `schedules/schedules a reply, lists it, and cancels it`, recorded with `--update` under `local` and `hosted`

## Out of scope
- A profile canceling only what it scheduled, and a creator that cannot read (380).
- Ending a schedule when its thread is deleted or its creator loses access (378, at send time).

## Notes
- Upstream `POST /schedules/:id/cancel` (`docs/04-reference/03-http.md` "Routes": "Its creator (as a profile, only what that profile scheduled), or `manage` in its channel. Answers `{ schedule, canceled }`"), `docs/01-board/07-schedules.md` ("Canceling one that's done is a no-op"), `ScheduleView.canceled` (`{ by, reason }`).
- The check is placed here, not on 373, because it schedules, lists and cancels: every route it uses exists only after this ticket.
- Canceling appends `ob.schedule.canceled`, which the existing fold projects into the state, `canceled` and a null `next`. The owner approved wiring the lookup into the locked BoardWriter in #570.
