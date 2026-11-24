---
id: 257
title: Change what a task needs
milestone: M9-tasks
package: core
writes:
  - docs/protocol.md
  - packages/cli/src/commands/derived.ts
  - packages/cli/src/commands/tasks/needs.ts
  - packages/cli/src/commands/usage.ts
  - packages/cli/test/tasks.test.ts
  - packages/contract/src/entities/events.ts
  - packages/contract/src/entities/task-events.ts
  - packages/contract/src/index.ts
  - packages/contract/src/operations/index.ts
  - packages/contract/src/operations/tasks/needs.ts
  - packages/core/src/events/tail.ts
  - packages/core/src/index.ts
  - packages/core/src/tasks/needs.ts
  - packages/core/src/tasks/events.ts
  - packages/core/src/tasks/readiness.ts
  - packages/driver-sql/src/views/events.ts
  - packages/driver-sql/src/views/tasks/task-folds.ts
  - packages/driver-sql/src/views/watchers/index.ts
  - packages/driver-sql/src/views/webhooks/deliveries.ts
  - packages/driver-sqlite/test/explain.test.ts
  - packages/server/openapi.json
  - packages/server/src/operations/events.ts
  - packages/server/src/operations/index.ts
  - packages/server/src/operations/tasks.ts
  - packages/server/src/operations/tasks/feed.ts
  - packages/server/src/operations/tasks/needs.ts
  - packages/server/test/isolation/cases.ts
  - packages/server/test/tasks/needs-change.test.ts
  - skills/openboard/SKILL.md
  - skills/openboard/references/commands.md
conformance: []
modes: [local, hosted]
depends_on: [256]
status: done
claimed_by: codex
issue: 431
---

## What the user does
As a planner, I change what a task waits for after creating it, `ob tasks needs 4 2 3` or `ob tasks needs 4 --none`.

## Done when
- [x] with 2 not completed, `ob tasks needs 4 2` prints `4 needs #2` and 4 reads `waiting`; naming only completed tasks makes it `ready` in the same write (`task.needs_changed` with state `waiting`, then `task.ready`); `ob tasks needs 4 --none` prints `4 needs nothing` and 4 reads `ready` (`task.needs_changed` with state `ready`, no `task.ready`); the same set again appends nothing
- [x] a change naming a thread that is no task or a canceled task prints `error: invalid_needs: …`; another profile of a connection without `manage` gets `error: task_not_owned: …`

## Out of scope
- Changes that would make a task wait for itself (258); changes on a claimed or finished task (259).
- A held task's needs (it stays held) and upstream's check of this ticket, which holds and unblocks: 263 (`.veebee/cut.md` moved the `[c]`).

## Notes
Upstream `POST /tasks/:id/needs { needs }` and "What a task needs can change … checked as a new task's are"; the expected events are those of upstream's check `changes what a task needs: …`.
