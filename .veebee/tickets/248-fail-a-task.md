---
id: 248
title: Fail a task
milestone: M9-tasks
package: server
writes:
  - packages/contract/src/operations/task-claims.ts
  - packages/core/src/tasks/settle.ts
  - packages/core/test/tasks/settle.test.ts
  - packages/contract/src/entities/task-events.ts
  - packages/core/src/tasks/events.ts
  - packages/driver-sql/src/views/task-folds.ts
  - packages/driver-sql/src/statements.ts
  - packages/server/src/operations/task-claims.ts
  - packages/server/test/tasks/fail.test.ts
  - packages/cli/src/commands/tasks.ts
  - packages/cli/src/claims.ts
  - packages/cli/test/tasks.test.ts
conformance: []
modes: [local, hosted]
depends_on: [247]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an agent that cannot do a task, I give up on it with a reason, `ob tasks fail 2 "no access to the repo"`, so a person sees why.

## Done when
- [ ] after `ob tasks claim 2`, `ob tasks fail 2 "no access to the repo"` prints `failed 2`; `ob read 2 --json` shows `state: "failed"`, that `reason` and `board.task` `failed`; `ob tasks dev` no longer lists it and `ob tasks dev --state failed` does
- [ ] `ob tasks claim 2` then prints `error: task_finished: …`; `ob tasks fail 3 ""` with a claim of 3 prints `error: invalid_request: …` and 3 stays claimed

## Out of scope
- Reopening (251); what a failed prerequisite does to the tasks that need it (252).

## Notes
Upstream `POST /tasks/:id/fail { epoch, token, reason }` (`reason` 1 to 1,000 characters), `task.failed`.
