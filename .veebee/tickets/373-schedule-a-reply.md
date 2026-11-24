---
id: 373
title: Schedule a reply
milestone: M13-data-files-schedules
package: server
writes:
  - packages/contract/src/entities/schedules.ts
  - packages/contract/src/operations/schedules.ts
  - packages/contract/src/operations/index.ts
  - packages/contract/src/index.ts
  - packages/core/src/schedules/create.ts
  - packages/core/src/schedules/timing.ts
  - packages/core/test/schedules/create.test.ts
  - packages/core/test/schedules/timing.test.ts
  - packages/core/src/index.ts
  - packages/ports/src/store.ts
  - packages/ports/testkit/store/schedules.test-suite.ts
  - packages/ports/testkit/index.ts
  - packages/driver-sql/migrations/*-schedules.sql
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/statements.ts
  - packages/driver-sql/src/views/schedules.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/driver-sql/src/views/purge.ts
  - packages/server/src/operations/schedules.ts
  - packages/server/src/operations/index.ts
  - packages/server/test/schedules/create.test.ts
  - packages/server/test/isolation/seed.ts
  - packages/cli/src/commands/schedule.ts
  - packages/cli/src/commands/index.ts
  - packages/cli/test/schedule.test.ts
conformance: []
modes: [local, hosted]
depends_on: [215, 364, 367]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a person, I schedule a nudge in a thread for tomorrow, `ob schedule 812 "@ada friendly ping: can you review?" --in 1d`, and the board answers when it will send and as whom.

## Done when
- [ ] `ob schedule 812 "@ada friendly ping: can you review?" --in 1d` prints `s1  #812 · once · next in 1d (<ISO time>) · by <my name>` and the text; `--json` prints `{ schedule, mentions, outcome: "scheduled" }` with `schedule.state: "pending"`, `re: "812"`, `noSync`, `sent: 0` and `next` one day after the board's clock; `ob schedule dev "standup?" --at <ISO time with offset>` schedules a new thread in `dev`
- [ ] `bun test packages/server/test/schedules/create.test.ts` passes on SQLite and Postgres (`OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard`): `in` with `at`, neither, a time past a year, `re` with `channel`, and a block that does not match its schema each answer 400 and store nothing; `every`, `until`, `for` and `times` answer 400 `invalid_request` saying repeats are not available yet; scheduling needs `post` in the channel (and `read` for a reply, `label` with `labels`); `attachments` are stored by ID like a post's; IDs run `s1`, `s2` per board and `12` is accepted for `s12`
- [ ] the board's audit lists `ob.schedule.created`, and `GET /events` shows nothing for it

## Out of scope
- Listing (374); canceling (375); `noSync` read back (376); repeats (377); sending, on any instance (378); downtime (379); who may cancel (380); schedules as webhook sources (381).
- Pending schedules under a thread read (374).

## Notes
- Upstream `POST /schedules` (`docs/04-reference/03-http.md` "Schedules": `channel` or `re`, `text`, `labels`, `noSync`, `attachments`, `in`, `at`, `every`, `until`, `for`, `times`; at most a year out; `{ schedule, mentions? }`), `docs/01-board/07-schedules.md` ("As whom": the creator exactly as resolved when scheduling, profile included; mentions settled when scheduling), `ScheduleView` in `@vercel/board`'s `dist/routes-*.d.mts`. docs/data-model.md `schedules` and "IDs" (`s<n>` from `boards.next_schedule`, which migration 0001 already has).
- The contract lands the whole `/schedules*` surface here (`POST /schedules`, `GET /schedules` with `re`, `channel`, `by`, `all`, `POST /schedules/:id/cancel`, `Ref("schedule")`), so 374 and 375 change handlers, not the contract; until they land, `GET /schedules` and the cancel answer 501 `no_scheduler`.
- `packages/core/src/schedules/timing.ts` parses durations (`30s`, `30m`, `12h`, `1d`) and times and computes the first send; it also holds the repeat fields' validation, refused here, so 377 lifts the refusal in this one file. Text, labels, mentions and blocks go through the same core functions as a post (`messages/post.ts`, `mentions.ts`, 364's `schemas/blocks.ts`), so a schedule is refused for what a post would be.
- Creating appends `ob.schedule.created` (board configuration, D23), folded into `schedules`; `appendEvent` (`packages/driver-sql/src/views/messages.ts`) dispatches it and `ob.schedule.canceled` (375) to fold functions in `views/schedules.ts`, so later schedule tickets do not touch `views/messages.ts`. The fold keeps the creator's actor, principal, profile and `creator` facts (stripped from views, docs/data-model.md "Boards and the log"). The table carries `org_id`: list it in `packages/driver-sql/src/views/purge.ts`. Seed a schedule in `packages/server/test/isolation/seed.ts`.
- `ob schedule` is hand-written for upstream's one-line summary (`docs/01-board/07-schedules.md`); it reads the text from stdin for `-` like `ob post`, passes `--every`, `--until`, `--for` and `--times` through, and already prints a repeat's summary (`every 30m until …`) from the view, so 377 does not touch the CLI.
- Depends on 364 so a schedule's blocks are checked like a post's (upstream checks `POST /schedules` too).
- Depends on 367, the last ticket before it to change `packages/core/src/index.ts`, `packages/ports/testkit/index.ts`, `packages/driver-sql/src/views/messages.ts`, `views/purge.ts` and `packages/server/test/isolation/seed.ts`.
