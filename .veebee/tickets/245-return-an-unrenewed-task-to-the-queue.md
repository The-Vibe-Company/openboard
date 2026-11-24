---
id: 245
title: Return an unrenewed task to the queue
milestone: M9-tasks
package: server
writes:
  - packages/core/src/tasks/expire.ts
  - packages/core/test/tasks/expire.test.ts
  - packages/core/src/tasks/claim.ts
  - packages/contract/src/entities/task-events.ts
  - packages/core/src/tasks/events.ts
  - packages/driver-sql/src/views/task-folds.ts
  - packages/driver-sql/src/statements.ts
  - packages/ports/src/tasks.ts
  - packages/ports/src/store.ts
  - packages/ports/testkit/store/tasks.test-suite.ts
  - packages/ports/testkit/isolation.test-suite.ts
  - packages/driver-sql/src/views/tasks.ts
  - packages/server/src/jobs/task-expiry.ts
  - packages/server/src/jobs/registry.ts
  - packages/server/src/operations/task-claims.ts
  - packages/server/src/operations/tasks.ts
  - packages/server/test/tasks/expiry.test.ts
conformance: []
modes: [local, hosted]
depends_on: [244, 211, 410]
status: draft
claimed_by: null
issue: 418
---

## What the user does
As a team running agents, a task whose agent died without renewing becomes ready again for the next agent, with no one stepping in.

## Done when
- [ ] `bun test packages/server/test/tasks/expiry.test.ts` passes with a fake clock: once `claim.until` passes, `GET /tasks?state=ready` lists the task and its thread reads `ready` before any write; the next claim appends `task.expired` then `task.claimed` with `epoch` 2; the expiry job (run by calling the runner) appends one `task.expired` and sets `board.task` back to `ready`; and the expired claim's complete answers 409 `claim_lost` and changes nothing

## Out of scope
- The same across two instances (246).
- A held task's expiry (262 returns it to `blocked`).

## Notes
- Upstream "A lease that runs out makes the task claimable at once, and `GET /tasks?state=ready` lists it. Its label says `ready` once the board appends `task.expired`: when its timer fires, or with the next claim." docs/data-model.md "Claims, leases, and dependencies" (lazy expiry: every command expires a dead claim first, reads compute the effective state; the job appends `task.expired` promptly), D24.
- The job runs on the `Jobs` port (181, `packages/server/src/jobs/registry.ts`): the claim's and the renewal's writes enqueue it for `claim_until`, so any instance runs it once (docs/architecture.md "Jobs any instance can take"). The global index `tasks_claims (claim_until) WHERE state = 'claimed'` serves a sweep after downtime, if one is needed: say in the PR. Depends on 211, the last ticket before it to register a job in `registry.ts`.

Waits for 410 (orchestrator, 2026-11-24, #418): carrying the next due time with the enqueue keeps every task write's statement count exact. A first draft of this ticket is on branch `t/245-return-an-unrenewed-task-to-the-queue`.
