---
id: 264
title: Assign a task to a profile
milestone: M9-tasks
package: server
writes:
  - packages/contract/src/operations/task-holds.ts
  - packages/contract/src/operations/tasks.ts
  - packages/contract/src/operations/task-batches.ts
  - packages/core/src/tasks/assign.ts
  - packages/core/test/tasks/assign.test.ts
  - packages/core/src/tasks/claim.ts
  - packages/core/src/tasks/create.ts
  - packages/contract/src/entities/task-events.ts
  - packages/core/src/tasks/events.ts
  - packages/driver-sql/src/views/task-folds.ts
  - packages/driver-sql/src/statements.ts
  - packages/server/src/operations/task-holds.ts
  - packages/server/src/operations/tasks.ts
  - packages/server/src/operations/task-batches.ts
  - packages/server/test/tasks/assign.test.ts
  - packages/cli/src/commands/tasks.ts
  - packages/cli/test/tasks.test.ts
conformance: ["tasks/keeps a task assigned to a profile for that actor alone"]
modes: [local, hosted]
depends_on: [263]
status: draft
claimed_by: null
issue: null
---

## What the user does
As the task's owner, I keep a task for one of my profiles, `ob tasks assign 2 fixer`, so only that agent claims it; `--pool` gives it back to anyone.

## Done when
- [ ] `ob tasks assign 2 fixer` prints `assigned 2 to fixer` and `ob read 2 --json` shows `for` the owner's `fixer` actor; `ob tasks claim 2` as the owner itself prints `error: task_assigned: …` while `ob tasks claim 2 --as fixer` takes it; `ob tasks create dev "x" --for fixer` assigns at creation
- [ ] `ob tasks assign 2 --pool` prints `unassigned 2` and anyone may claim it; assigning to an actor that is not one of the owner's prints `error: invalid_request: …`
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `tasks/keeps a task assigned to a profile for that actor alone`, and `--update` records it in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- Claim-next preferring the caller's assigned tasks (265).

## Notes
Upstream `POST /tasks/:id/assign { for }` ("one of the owner's actors, or `null`"), `for` on create and in a batch, `task.assigned`; the owner's rule (250); index `tasks_for`.
