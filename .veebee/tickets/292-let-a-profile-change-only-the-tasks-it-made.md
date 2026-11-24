---
id: 292
title: Let a profile change only the tasks it made
milestone: M10-access
package: core
writes:
  - packages/core/src/tasks/ownership.ts
  - packages/core/test/tasks/ownership.test.ts
  - packages/server/test/tasks/profile-ownership.test.ts
conformance: ["tasks/lets a profile change only the tasks it made, and its principal all of them"]
modes: [local, hosted]
depends_on: [264, 272, 286]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a principal running several agents, each agent changes only the tasks it made, while I as myself change all of them.

## Done when
- [ ] narrowed with `x-board-can: dev=read,post,react,label` and writing as profile `own`, a caller gets 403 `task_not_owned` assigning, holding, cancelling or changing the needs of its principal's task, and of a task another profile made, while it changes its own; its principal as itself, narrowed the same, changes all of them
- [ ] the principal making the profile's thread a task, then the profile editing that root, holds the task (`blocked.kind` `edited`, 272)
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `tasks/lets a profile change only the tasks it made, and its principal all of them`, and `--update` records it in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- The ownership rule itself (250).

## Notes
Upstream "Who edits what" (`docs/01-board/09-access.md`); with `manage` in the channel anyone changes a task (250), which is why upstream's check narrows to no `manage`. Depends on 272 too: the check ends with the profile's edit.
