---
id: 252
title: Hold a task until what it needs completes
milestone: M9-tasks
package: core
writes:
  - packages/contract/src/operations/tasks.ts
  - packages/core/src/tasks/needs.ts
  - packages/core/test/tasks/needs.test.ts
  - packages/core/src/tasks/readiness.ts
  - packages/core/test/tasks/readiness.test.ts
  - packages/core/src/tasks/create.ts
  - packages/core/src/tasks/settle.ts
  - packages/contract/src/entities/task-events.ts
  - packages/core/src/tasks/events.ts
  - packages/driver-sql/src/views/task-folds.ts
  - packages/driver-sql/src/statements.ts
  - packages/ports/src/tasks.ts
  - packages/ports/testkit/store/tasks.test-suite.ts
  - packages/ports/testkit/isolation.test-suite.ts
  - packages/driver-sql/src/views/tasks.ts
  - packages/server/src/operations/tasks.ts
  - packages/server/src/operations/task-claims.ts
  - packages/server/test/tasks/needs.test.ts
  - packages/cli/src/commands/tasks.ts
  - packages/cli/test/tasks.test.ts
conformance: ["tasks/holds a task until the tasks it needs complete, which a failed or canceled one never does"]
modes: [local, hosted]
depends_on: [251]
status: draft
claimed_by: null
issue: 425
---

## What the user does
As a planner, I create a task that waits for another, `ob tasks create dev "deploy" --needs 2`, and it becomes ready on its own once 2 completes.

## Done when
- [ ] with 2 not completed, `ob tasks create dev "deploy" --needs 2` prints `3`; `ob read 3 --json` shows `state: "waiting"`, `needs: ["2"]` and `board.task` `waiting`; `ob tasks claim 3` prints `error: task_waiting: …`
- [ ] when 2 fails, 3 stays `waiting`; once 2 is reopened, claimed and completed, 3 reads `ready`, changed in 2's completing write; `--needs` naming a thread that is no task, or (with `ob tasks create 5 --needs 5`) the thread itself, prints `error: invalid_needs: …` and makes nothing
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `tasks/holds a task until the tasks it needs complete, which a failed or canceled one never does`, and `--update` records it in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- Refusing a canceled prerequisite (253); the `task.ready` event cases (254).
- Changing needs later (257); a narrowed caller's unreadable prerequisite (291).

## Notes
- docs/data-model.md "Claims, leases, and dependencies" (`task_needs` edges, `waiting_on` counters) and "How folds are derived" (`task.completed` decrements the dependants' `waiting_on`; the command appends their `task.ready`). Upstream "Completing a task readies each task that waited only for it, in the same write. A failed or canceled one readies nothing"; at most 20 needs (400 `invalid_request`).
- `core/tasks/needs.ts` checks a set of needs (tasks, readable by the caller, 253 adds "not canceled"); `core/tasks/readiness.ts` says what a write readies. 291 changes the first while M9 changes the second, so keep them apart.
