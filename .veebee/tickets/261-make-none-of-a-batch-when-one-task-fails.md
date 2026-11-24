---
id: 261
title: Make none of a batch when one task fails
milestone: M9-tasks
package: core
writes:
  - packages/core/src/tasks/batch.ts
  - packages/core/test/tasks/batch.test.ts
  - packages/server/test/tasks/batch-refused.test.ts
conformance: ["tasks/makes none of a batch when one of its tasks can not be made, wherever it comes in it"]
modes: [local, hosted]
depends_on: [260]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a planner, a plan with one bad task makes nothing, so I never clean up half a plan.

## Done when
- [ ] a plan with a `key` two tasks have, a `{ key }` no task has, a task that needs itself, two tasks that need each other, or a last task that needs a canceled one prints `error: invalid_needs: …`, and `ob tasks dev --state all` lists none of its tasks
- [ ] a plan of 101 tasks prints `error: batch_too_large: …` and makes nothing
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `tasks/makes none of a batch when one of its tasks can not be made, wherever it comes in it`, and `--update` records it in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- Sending a longer plan in parts, as upstream's `createTasksInChunks` does: not planned.

## Notes
Upstream "A `key` two tasks have, one no task has, and tasks that wait for each other are 400 `invalid_needs`"; "More than 100 tasks … is 400 `batch_too_large`".
