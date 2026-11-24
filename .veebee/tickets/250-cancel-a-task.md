---
id: 250
title: Cancel a task
milestone: M9-tasks
package: server
writes:
  - packages/contract/src/operations/task-changes.ts
  - packages/contract/src/operations/index.ts
  - packages/core/src/tasks/cancel.ts
  - packages/core/test/tasks/cancel.test.ts
  - packages/core/src/tasks/ownership.ts
  - packages/core/test/tasks/ownership.test.ts
  - packages/contract/src/entities/task-events.ts
  - packages/core/src/tasks/events.ts
  - packages/driver-sql/src/views/task-folds.ts
  - packages/driver-sql/src/statements.ts
  - packages/server/src/operations/task-changes.ts
  - packages/server/src/operations/index.ts
  - packages/server/test/tasks/cancel.test.ts
  - packages/server/test/isolation/cases.ts
  - packages/cli/src/commands/tasks.ts
  - packages/cli/test/tasks.test.ts
conformance: []
modes: [local, hosted]
depends_on: [249]
status: draft
claimed_by: null
issue: 423
---

## What the user does
As the person who posted a task, I call it off with a reason, `ob tasks cancel 2 "not needed"`, whatever state it is in short of done.

## Done when
- [ ] `ob tasks cancel 2 "not needed"` prints `canceled 2`; `ob read 2 --json` shows `state: "canceled"`, that `reason`, `claim: null` and `board.task` `canceled`; a second `ob tasks cancel 2 "again"` and `ob tasks claim 2` print `error: task_finished: …`, as does cancelling a completed task
- [ ] with a direct connection made by `ob connections create agents --direct --can '*=read,post,react,label' --secret-file ./agents.secret` and `BOARD_TOKEN` read from that file, a task made `--as fixer-1` refuses `ob tasks cancel <id> "no" --as fixer-2` with `error: task_not_owned: …`, while `--as fixer-1`, the connection as itself (no `--as`), and the local owner (`manage` there) may cancel it

## Out of scope
- Cancelling when the root is deleted (271).
- What a canceled prerequisite means for tasks that need it (252, 253).
- Upstream's narrowed-profile ownership check (292).

## Notes
- Upstream `POST /tasks/:id/cancel { reason }`, "any task that hasn't completed or been canceled"; `task.canceled`.
- First owner-only change: upstream "Its owner changes it, while it may post or label in its channel, and so does `manage` there … Anyone else gets 403 `task_not_owned`. A caller that writes as a profile owns only the tasks it made, and its principal, as no profile, any of them" (`docs/01-board/09-access.md` "Who edits what"). Write it once in `core/tasks/ownership.ts`; reopen, needs, hold, unblock and assign (251, 257, 262-264) call it.
