---
id: 261
title: Make none of a batch when one task fails
milestone: M9-tasks
package: core
writes:
  - packages/contract/src/operations/tasks/batch.ts
  - packages/contract/src/operation.ts
  - packages/server/openapi.json
  - docs/protocol.md
  - skills/openboard/SKILL.md
  - skills/openboard/references/commands.md
  - tools/conformance/score.json
  - packages/server/test/tasks/batch-refused.test.ts
conformance: ["tasks/makes none of a batch when one of its tasks can not be made, wherever it comes in it"]
modes: [local, hosted]
depends_on: [260]
status: done
claimed_by: codex
issue: 435
---

## What the user does
As a planner, a plan with one bad task makes nothing, so I never clean up half a plan.

## Done when
- [x] a plan with a `key` two tasks have, a `{ key }` no task has, a task that needs itself, two tasks that need each other, or a last task that needs a canceled one prints `error: invalid_needs: …`, and `ob tasks dev --state all` lists none of its tasks
- [x] a plan of 101 tasks prints `error: batch_too_large: …` and makes nothing
- [x] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `tasks/makes none of a batch when one of its tasks can not be made, wherever it comes in it`, and `--update` records it in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- Sending a longer plan in parts, as upstream's `createTasksInChunks` does: not planned.

## Notes
Upstream "A `key` two tasks have, one no task has, and tasks that wait for each other are 400 `invalid_needs`"; "More than 100 tasks … is 400 `batch_too_large`".
