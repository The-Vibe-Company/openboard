---
id: 291
title: Refuse a prerequisite a narrowed caller cannot read
milestone: M10-access
package: core
writes:
  - packages/core/src/tasks/needs.ts
  - packages/core/test/tasks/needs.test.ts
  - packages/server/src/operations/tasks.ts
  - packages/server/src/operations/task-changes.ts
  - packages/server/src/operations/task-batches.ts
  - packages/server/test/tasks/narrowed-needs.test.ts
conformance: ["tasks/takes read in a prerequisite's channel to wait for it: a caller narrowed out of it makes no task that needs it"]
modes: [local, hosted]
depends_on: [261, 264, 286]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a board owner, an agent narrowed out of a channel cannot learn about or wait on tasks there.

## Done when
- [ ] narrowed with `x-board-can: *=post;dev=read,post,label`, creating a task in `dev` that needs a task in `dev/tasks`, making a thread a task with that need, changing a task's needs to it, or a batch naming it answer 400 `invalid_needs` and make nothing; `GET /tasks?needs=<that task>` lists none; a need on a task in `dev` makes a `waiting` task
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `tasks/takes read in a prerequisite's channel to wait for it: a caller narrowed out of it makes no task that needs it`, and `--update` records it in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- The cycle walk's handling of unreadable tasks (258).

## Notes
Upstream "`needs` names tasks the caller can read"; an unreadable task answers as a missing one would. Depends on 264 as well: 264 adds `for` in `server/src/operations/tasks.ts` and `task-batches.ts`.
