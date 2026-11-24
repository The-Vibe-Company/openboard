---
id: 243
title: Complete a claimed task
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
  - packages/server/test/tasks/complete.test.ts
  - packages/cli/src/commands/tasks.ts
  - packages/cli/src/claims.ts
  - packages/cli/test/tasks.test.ts
  - docs/protocol.md
  - packages/cli/src/commands/derived.ts
  - packages/cli/src/commands/tasks/complete.ts
  - packages/contract/src/entities/events.ts
  - packages/contract/src/index.ts
  - packages/contract/src/operation.ts
  - packages/contract/src/operations/index.ts
  - packages/contract/src/operations/tasks/complete.ts
  - packages/core/src/index.ts
  - packages/driver-sql/src/views/events.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/driver-sql/src/views/tasks/task-folds.ts
  - packages/driver-sql/src/views/tasks/tasks.ts
  - packages/ports/src/tasks.ts
  - packages/ports/testkit/isolation-seed.ts
  - packages/ports/testkit/isolation.test-suite.ts
  - packages/server/openapi.json
  - packages/server/src/operations/events.ts
  - packages/server/src/operations/index.ts
  - packages/server/src/operations/tasks/complete.ts
  - packages/server/test/isolation/cases.ts
  - skills/openboard/references/commands.md
  - tools/conformance/score.json
conformance: ["tasks/gives a task to one of the claims that race for it, and takes its result"]
modes: [local, hosted]
depends_on: [242]
status: done
claimed_by: codex
issue: 416
---

## What the user does
As an agent, I finish the task I hold with its result, `ob tasks complete 2 "fixed in a1b2c3"`.

## Done when
- [x] after `ob tasks claim 2`, `ob tasks complete 2 "fixed in a1b2c3"` prints `completed 2`; `ob read 2 --json` shows `state: "completed"`, that `result`, `claim: null` and `board.task` `completed`; the CLI's claim store no longer holds the claim
- [x] `ob tasks claim 2` then prints `error: task_finished: …`; `ob tasks dev` no longer lists 2 and `ob tasks dev --state completed` does
- [x] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `tasks/gives a task to one of the claims that race for it, and takes its result`, and `--update` records it in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- Fencing in full (wrong token, older epoch, after release, past the lease: 249).
- Readying the tasks that need it (252).
- The bench's task cycle (274).

## Notes
Upstream `POST /tasks/:id/complete { epoch, token, result? }` (`result` up to 1,000 characters), `task.completed` with upstream's payload and no token. Here a complete lands only with the live claim's epoch and token; 249 makes every claim write share that check (`core/tasks/fence.ts`).
