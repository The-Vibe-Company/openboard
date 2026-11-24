---
id: 264
title: Assign a task to a profile
milestone: M9-tasks
package: server
writes:
  - docs/data-model.md
  - docs/protocol.md
  - packages/cli/src/commands/derived.ts
  - packages/cli/src/commands/tasks/assign.ts
  - packages/cli/src/commands/usage.ts
  - packages/contract/src/entities/events.ts
  - packages/contract/src/entities/task-events.ts
  - packages/contract/src/index.ts
  - packages/contract/src/operations/index.ts
  - packages/contract/src/operations/tasks/assign.ts
  - packages/contract/src/operations/tasks/batch.ts
  - packages/contract/src/operations/tasks/create.ts
  - packages/core/src/events/tail.ts
  - packages/core/src/index.ts
  - packages/core/src/tasks/assignment/assign.ts
  - packages/core/src/tasks/claim.ts
  - packages/core/src/tasks/create.ts
  - packages/core/src/tasks/events.ts
  - packages/driver-sql/src/views/events.ts
  - packages/driver-sql/src/views/tasks/task-folds.ts
  - packages/driver-sql/src/views/watchers/index.ts
  - packages/driver-sql/src/views/webhooks/deliveries.ts
  - packages/server/openapi.json
  - packages/server/src/operations/events.ts
  - packages/server/src/operations/index.ts
  - packages/server/src/operations/tasks.ts
  - packages/server/src/operations/tasks/assign.ts
  - packages/server/src/operations/tasks/batch.ts
  - packages/server/src/operations/tasks/feed.ts
  - packages/server/test/isolation/cases.ts
  - packages/server/test/tasks/assign.test.ts
  - skills/openboard/SKILL.md
  - skills/openboard/references/commands.md
  - tools/conformance/score.json
conformance: ["tasks/keeps a task assigned to a profile for that actor alone"]
modes: [local, hosted]
depends_on: [263]
status: done
claimed_by: codex
issue: 438
---

## What the user does
As the task's owner, I keep a task for one of my profiles, `ob tasks assign 2 fixer`, so only that agent claims it; `--pool` gives it back to anyone.

## Done when
- [x] `ob tasks assign 2 fixer` prints `assigned 2 to fixer` and `ob read 2 --json` shows `for` the owner's `fixer` actor; `ob tasks claim 2` as the owner itself prints `error: task_assigned: …` while `ob tasks claim 2 --as fixer` takes it; `ob tasks create dev "x" --for fixer` assigns at creation
- [x] `ob tasks assign 2 --pool` prints `unassigned 2` and anyone may claim it; assigning to an actor that is not one of the owner's prints `error: invalid_request: …`
- [x] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `tasks/keeps a task assigned to a profile for that actor alone`, and `--update` records it in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- Claim-next preferring the caller's assigned tasks (265).

## Notes
Upstream `POST /tasks/:id/assign { for }` ("one of the owner's actors, or `null`"), `for` on create and in a batch, `task.assigned`; the owner's rule (250); index `tasks_for`.
