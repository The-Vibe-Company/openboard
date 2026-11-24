---
id: 270
title: Refuse a label under board.
milestone: M9-tasks
package: core
writes:
  - .veebee/tickets/270-refuse-a-label-under-board.md
  - packages/core/src/messages/labels.ts
  - packages/core/test/messages/labels.test.ts
  - packages/server/test/tasks/reserved-labels.test.ts
  - tools/conformance/score.json
conformance: ["tasks/keeps labels under board. its own: a label write or a post that sets one is refused"]
modes: [local, hosted]
depends_on: [238]
status: done
claimed_by: codex
issue: 444
---

## What the user does
As the board, I keep `board.task` mine: no label write or post sets or unsets a label under `board.`, while a write may still hold on one with `--if`.

## Done when
- [x] on task 2, `ob label 2 board.task=completed` and `ob label 2 --unset board.task` print `error: reserved_label: …`, as do `ob post dev x --label board.task=ready` and `ob tasks create dev x --label board.x=1`; 2 still reads `ready`
- [x] `ob label 2 seen=yes --if board.task=ready` sets `seen`, while `--if board.task=claimed` and `--if-unset board.task` print `error: label_conflict: …` and change nothing
- [x] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `tasks/keeps labels under board. its own: a label write or a post that sets one is refused`, and `--update` records it in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- Schedules with `board.` labels (M13).

## Notes
`checkLabelKey` in `packages/core/src/messages/labels.ts` already refuses `board.` keys in `set`, `unset` and posts; conditions (`if`) must accept them, as upstream's check holds a label write on `board.task`. Task creates reuse `checkLabels` (238): this ticket edits no task file, so it runs beside 239-269.
