---
id: 251
title: Reopen a failed task
milestone: M9-tasks
package: server
writes:
  - packages/contract/src/operations/task-changes.ts
  - packages/core/src/tasks/reopen.ts
  - packages/core/test/tasks/reopen.test.ts
  - packages/contract/src/entities/task-events.ts
  - packages/core/src/tasks/events.ts
  - packages/driver-sql/src/views/task-folds.ts
  - packages/driver-sql/src/statements.ts
  - packages/server/src/operations/task-changes.ts
  - packages/server/test/tasks/reopen.test.ts
  - packages/cli/src/commands/tasks.ts
  - packages/cli/test/tasks.test.ts
conformance: ["tasks/fences what a claim does: once it's over, its writes are lost and change nothing"]
modes: [local, hosted]
depends_on: [250]
status: draft
claimed_by: null
issue: 424
---

## What the user does
As the owner of a failed task, I put it back in the queue with `ob tasks reopen 2` once the cause is fixed.

## Done when
- [ ] after a claim and `ob tasks fail 2 "no access"`, `ob tasks reopen 2` prints `reopened 2`; `ob read 2 --json` shows `ready` and `board.task` `ready`; reopening a ready task changes nothing (`--json` outcome `unchanged`, no event), and a completed or canceled one prints `error: task_finished: …`
- [ ] another profile of a connection without `manage` gets `error: task_not_owned: …` (250's rule)
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `tasks/fences what a claim does: once it's over, its writes are lost and change nothing`, and `--update` records it in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- Reopening a held task: unblock it instead (263).

## Notes
- Upstream `POST /tasks/:id/reopen` (no body, "A failed task is ready again"), `task.reopened`; upstream's CLI prints `unchanged` for a reopen with nothing to change.
- Upstream's fencing check ends with a reopen, so `.veebee/cut.md` moved its `[c]` here from 249.
