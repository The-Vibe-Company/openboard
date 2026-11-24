---
id: 258
title: Refuse needs that make a task wait for itself
milestone: M9-tasks
package: core
writes:
  - packages/core/src/tasks/needs.ts
  - packages/core/test/tasks/needs.test.ts
  - packages/ports/src/tasks.ts
  - packages/ports/testkit/store/tasks.test-suite.ts
  - packages/driver-sql/src/views/tasks.ts
  - packages/driver-sql/src/statements.ts
  - packages/server/test/tasks/needs-cycle.test.ts
conformance: ["tasks/refuses a change of needs that would make a task wait for itself, straight back or through others"]
modes: [local, hosted]
depends_on: [257]
status: draft
claimed_by: null
issue: 432
---

## What the user does
As a planner, I cannot make two tasks wait for each other, so no task waits forever.

## Done when
- [ ] with 3 needing 2 and 4 needing 3, `ob tasks needs 2 2`, `ob tasks needs 2 3` and `ob tasks needs 2 4` each print `error: invalid_needs: …` and 2 stays `ready` with no needs; after `ob tasks needs 3 --none`, `ob tasks needs 2 4` makes 2 wait
- [ ] `bun test packages/core/test/tasks/needs.test.ts` passes: the walk follows up to 500 tasks behind the ones a change adds and refuses a change it would have to walk further for; it skips completed tasks the caller can read and walks those it cannot; a change that only drops needs walks nothing
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `tasks/refuses a change of needs that would make a task wait for itself, straight back or through others`, and `--update` records it in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- Cycles inside a batch (261).

## Notes
docs/data-model.md "Dependencies" ("cycle check walks `task_needs` from the new prerequisites looking for the task, skipping completed tasks the caller can read, up to 500 tasks"); upstream's text under "What a task needs can change". The walk reads under the lock, level by level or as one recursive query both engines run (the statement registry `EXPLAIN`s it on both, 165).
