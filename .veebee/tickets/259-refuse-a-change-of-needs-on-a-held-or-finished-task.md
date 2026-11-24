---
id: 259
title: Refuse a change of needs on a held or finished task
milestone: M9-tasks
package: core
writes:
  - packages/core/src/tasks/needs.ts
  - packages/core/test/tasks/needs.test.ts
  - packages/server/test/tasks/needs-state.test.ts
conformance: ["tasks/changes what a task needs only while no one holds it and it has not finished"]
modes: [local, hosted]
depends_on: [258]
status: draft
claimed_by: null
issue: 433
---

## What the user does
As an agent holding a task, no one changes what it waits for under me, and a finished task's needs stay as they were.

## Done when
- [ ] while 2 is claimed, `ob tasks needs 2 3` prints `error: task_claimed: …` and 2 keeps its needs; after `ob tasks release 2`, the same command makes it wait on 3
- [ ] on a completed, failed or canceled task, `ob tasks needs <id> 3` prints `error: task_finished: …`
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `tasks/changes what a task needs only while no one holds it and it has not finished`, and `--update` records it in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- A blocked task's needs, which may change (263).

## Notes
Upstream "What a task needs can change, while it's waiting, ready, or blocked and no one has claimed it … A claimed task is 409 `task_claimed`, and a finished one 409 `task_finished`".
