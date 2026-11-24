---
id: 263
title: Lift a hold on a task
milestone: M9-tasks
package: server
writes:
  - packages/contract/src/operations/task-holds.ts
  - packages/core/src/tasks/hold.ts
  - packages/core/test/tasks/hold.test.ts
  - packages/core/src/tasks/readiness.ts
  - packages/core/test/tasks/readiness.test.ts
  - packages/contract/src/entities/task-events.ts
  - packages/core/src/tasks/events.ts
  - packages/driver-sql/src/views/task-folds.ts
  - packages/driver-sql/src/statements.ts
  - packages/server/src/operations/task-holds.ts
  - packages/server/test/tasks/unblock.test.ts
  - packages/cli/src/commands/tasks.ts
  - packages/cli/test/tasks.test.ts
conformance: ["tasks/holds a task for a person, by its owner or its claim, and gives it back when unblocked", "tasks/says task.ready each time a task that needs others becomes ready: right after it is made or unblocked, once they have completed", "tasks/changes what a task needs: it waits for the new ones, is ready once they have completed, and at once with none"]
modes: [local, hosted]
depends_on: [262]
status: draft
claimed_by: null
issue: null
---

## What the user does
As the task's owner, I lift a hold with `ob tasks unblock 2`, and the task goes back to ready, or to waiting if what it needs has not completed.

## Done when
- [ ] `ob tasks unblock 2` prints `unblocked 2` and 2 reads `ready`; a held task whose needs have not completed reads `waiting` after unblocking, then `ready` once they complete; unblocking a task that is not held changes nothing (`--json` outcome `unchanged`)
- [ ] changing what a held task needs keeps it `blocked` (`task.needs_changed` with state `blocked`), and unblocking it once those needs have completed appends `task.unblocked` (`waiting`) then `task.ready` (`ready`) in one write
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `tasks/holds a task for a person, by its owner or its claim, and gives it back when unblocked` and `tasks/says task.ready each time a task that needs others becomes ready: right after it is made or unblocked, once they have completed` and `tasks/changes what a task needs: it waits for the new ones, is ready once they have completed, and at once with none`, and `--update` records them in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- Assigning (264); the board's own hold on an edit (272).

## Notes
- Upstream `POST /tasks/:id/unblock` (no body; "A task that isn't blocked stays as it is"); the owner's rule (250), never the claim's.
- Upstream's `task.ready` and needs-change checks hold and unblock tasks, so `.veebee/cut.md` moved their `[c]` here from 254 and 257. They read the feed filtered by `channel` and `label`, with `wait` (95-97), which 238's dependency on 99 brings.
