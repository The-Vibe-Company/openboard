---
id: 254
title: Say task.ready when a waiting task becomes ready
milestone: M9-tasks
package: server
writes:
  - packages/core/src/tasks/readiness.ts
  - packages/core/test/tasks/readiness.test.ts
  - packages/core/src/tasks/create.ts
  - packages/server/src/operations/tasks.ts
  - packages/server/test/tasks/ready-events.test.ts
conformance: []
modes: [local, hosted]
depends_on: [253]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an agent following the feed, I learn the moment a task I wait for can be taken, from its `task.ready` event.

## Done when
- [ ] `bun test packages/server/test/tasks/ready-events.test.ts` passes: completing the last prerequisite appends `task.completed` then each dependant's `task.ready`, each on `GET /events` with `message.task.state` as it is after it; a task made with needs that have all completed lands as `task.created` (`waiting`) then `task.ready` (`ready`), and made with `claim: true` its `task.claimed` follows in the same write; a task made with no needs has no `task.ready`

## Out of scope
- Unblocking a held task that needs others; upstream's `task.ready` check holds and unblocks tasks, so 263 records it (`.veebee/cut.md` moved the `[c]`).
- Filtering the feed on `board.task=ready` (269).

## Notes
Upstream "One that waits only for tasks that were there and have all completed is `ready`, and its `task.ready` follows in the write" and the check's expected order (`task.created` waiting, `task.ready` ready, `task.claimed` claimed). Each event's `message` is the root's view after that event.
