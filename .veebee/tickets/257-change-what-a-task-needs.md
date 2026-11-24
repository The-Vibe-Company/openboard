---
id: 257
title: Change what a task needs
milestone: M9-tasks
package: core
writes:
  - packages/contract/src/operations/task-changes.ts
  - packages/core/src/tasks/needs.ts
  - packages/core/test/tasks/needs.test.ts
  - packages/core/src/tasks/readiness.ts
  - packages/core/test/tasks/readiness.test.ts
  - packages/contract/src/entities/task-events.ts
  - packages/core/src/tasks/events.ts
  - packages/driver-sql/src/views/task-folds.ts
  - packages/driver-sql/src/statements.ts
  - packages/ports/src/tasks.ts
  - packages/driver-sql/src/views/tasks.ts
  - packages/server/src/operations/task-changes.ts
  - packages/server/test/tasks/needs-change.test.ts
  - packages/cli/src/commands/tasks.ts
  - packages/cli/test/tasks.test.ts
conformance: []
modes: [local, hosted]
depends_on: [256]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a planner, I change what a task waits for after creating it, `ob tasks needs 4 2 3` or `ob tasks needs 4 --none`.

## Done when
- [ ] with 2 not completed, `ob tasks needs 4 2` prints `4 needs #2` and 4 reads `waiting`; naming only completed tasks makes it `ready` in the same write (`task.needs_changed` with state `waiting`, then `task.ready`); `ob tasks needs 4 --none` prints `4 needs nothing` and 4 reads `ready` (`task.needs_changed` with state `ready`, no `task.ready`); the same set again appends nothing
- [ ] a change naming a thread that is no task or a canceled task prints `error: invalid_needs: …`; another profile of a connection without `manage` gets `error: task_not_owned: …`

## Out of scope
- Changes that would make a task wait for itself (258); changes on a claimed or finished task (259).
- A held task's needs (it stays held) and upstream's check of this ticket, which holds and unblocks: 263 (`.veebee/cut.md` moved the `[c]`).

## Notes
Upstream `POST /tasks/:id/needs { needs }` and "What a task needs can change … checked as a new task's are"; the expected events are those of upstream's check `changes what a task needs: …`.
