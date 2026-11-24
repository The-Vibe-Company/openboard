---
id: 253
title: Refuse a canceled prerequisite
milestone: M9-tasks
package: core
writes:
  - packages/core/src/tasks/needs.ts
  - packages/core/test/tasks/needs.test.ts
  - packages/server/test/tasks/canceled-needs.test.ts
conformance: ["tasks/refuses a prerequisite that was canceled, which can never complete, and takes one that failed"]
modes: [local, hosted]
depends_on: [252]
status: draft
claimed_by: null
issue: 426
---

## What the user does
As a planner, I am told at once when a task I create would wait forever on a canceled one.

## Done when
- [ ] after `ob tasks cancel 2 "dropped"`, `ob tasks create dev "x" --needs 2` and `ob tasks create 5 --needs 2` (making thread 5 a task) print `error: invalid_needs: …`, and thread 5 stays no task
- [ ] after a claim and `ob tasks fail 3 "x"`, `ob tasks create dev "y" --needs 3` makes a `waiting` task with `needs: ["3"]`
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `tasks/refuses a prerequisite that was canceled, which can never complete, and takes one that failed`, and `--update` records it in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- The same rule for a change of needs (257) and in a batch (261).

## Notes
Upstream "`needs` names tasks the caller can read, none of them canceled: one that was can never complete".
