---
id: 420
title: Cancel the tasks waiting on a prerequisite that is canceled or deleted
milestone: M9-tasks
package: core
writes:
  - packages/core/src/tasks/cancel.ts
  - packages/core/src/tasks/readiness.ts
  - packages/core/src/messages/delete.ts
  - packages/server/src/operations/tasks/cancel.ts
  - packages/server/src/operations/messages.ts
  - packages/driver-sql/src/views/tasks/task-folds.ts
  - packages/server/test/tasks/dependants-cancel.test.ts
  - docs/protocol.md
  - skills/openboard/SKILL.md
conformance: []
modes: [local, hosted]
depends_on: [252, 253, 271]
status: dropped
issue: 817
---

## What the user does
As a planner, when a task others wait on is canceled (`ob tasks cancel`) or its root is deleted, the tasks waiting on it do not wait forever: they are canceled in the same write, with reason `prerequisite #<id> canceled`, and the cancellation cascades to their own waiting dependants.

## Done when
- [ ] `bun test packages/server/test/tasks/dependants-cancel.test.ts` passes on SQLite and Postgres (`OPENBOARD_TEST_DRIVER=postgres`): with B waiting on A and C waiting on B, `ob tasks cancel A "dropped"` appends `task.canceled` for A, then B, then C in one write, B and C with reason `prerequisite #A canceled` / `prerequisite #B canceled`; a task waiting on A and on an already completed task is canceled too; a completed or already canceled dependant is left alone
- [ ] deleting A's root (`ob delete A`) cancels B and C the same way, and `ob tasks B` shows `canceled` with that reason

## Rules
- Same write, same cursor sequence as the cause (as #786 does for a deleted root); no job, no second request.
- A failed prerequisite does not cancel its dependants (it can still be reopened and completed, D: #816).

## Out of scope
Notifying the dependants' owners (watchers and webhooks already see `task.canceled`). Re-opening canceled dependants.

## Notes
Gap documented in #805 (ticket 252): "canceling or deleting an unfinished prerequisite can leave its dependants waiting indefinitely". #816 (ticket 253) refuses a canceled prerequisite at creation only.

## Dropped
Upstream compatibility wins: the pinned conformance kit requires a dependant to stay `waiting` after its prerequisite is canceled (decided on #817, recorded in docs/decisions.md "Dependants of a canceled prerequisite"). #816 refuses a canceled prerequisite at creation; cancel dependants explicitly.
