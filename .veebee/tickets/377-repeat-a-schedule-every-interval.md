---
id: 377
title: Repeat a schedule every interval
milestone: M13-data-files-schedules
package: core
writes:
  - packages/core/src/schedules/timing.ts
  - packages/core/test/schedules/timing.test.ts
  - packages/server/test/schedules/repeat.test.ts
conformance: []
modes: [local, hosted]
depends_on: [373]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an agent, I ask the board to ping a thread every 30 minutes for a day, `ob schedule 812 "@pi check prod" --every 30m --for 1d`, and it does, then stops on its own.

## Done when
- [ ] `ob schedule 812 "@pi check prod" --every 30m --for 1d` prints `s1  #812 · every 30m until <ISO time> · next in 30m (…)`; `--every 30m --times 3`, `--every 1d --at <ISO time>` and `--every 1h --until <ISO time>` are accepted; `--every 30s`, two stops, and a stop without `--every` print `error: invalid_request: …`
- [ ] `bun test packages/server/test/schedules/repeat.test.ts` passes on SQLite and Postgres with a fake clock: a repeat is stored and listed with `every` in milliseconds, `until` or `times`, and `next` at its first slot (`at`, `in`, or one `every` from now); `bun test packages/core/test/schedules/timing.test.ts` covers the slot after each send for `--every 1m --times 3` (slots 0, 1, 2, then none), `--for` and `--until` (the last slot inside them), and the one-year reach of the first send, the stop and the repeat

## Out of scope
- Sending each slot (378, which asks this file for the slot after a send); what happens to slots missed while nothing ran (379).

## Notes
- Upstream `docs/04-reference/03-http.md` "Schedules" (`every` at least `1m`; `until`, `for`, `times`; one stop, only with `every`) and `docs/01-board/07-schedules.md` "When it sends".
- 373 left the repeat fields refused in `packages/core/src/schedules/timing.ts`; this ticket lifts that and adds the slot after a send (none for a one-off), which 378's send path calls. Nothing else changes, so it touches neither the job nor the views; 378 checks the sends of a repeat end to end.
