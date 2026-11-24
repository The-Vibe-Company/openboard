---
id: 330
title: Hold, release or cancel a task from an inbound rule
milestone: M11-webhooks-and-watchers
package: server
writes:
  - packages/core/src/inbound/actions.ts
  - packages/core/test/inbound/actions.test.ts
  - packages/server/src/inbound/run.ts
  - packages/server/test/inbound/task-holds.test.ts
conformance: []
modes: [local, hosted]
depends_on: [263, 329]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a person, when the runner reports that an agent is blocked, the task is held with the agent's reason; when it reports it may go on, the hold is lifted; and a run abandoned for good cancels the task.

## Done when
- [ ] `bun test packages/server/test/inbound/task-holds.test.ts` passes: `{ "task.block": { "kind": "agent", "reason": "{{body.reason}}" } }` appends `task.blocked` with that reason, `{ "task.unblock": {} }` appends `task.unblocked`, `{ "task.cancel": {} }` appends `task.canceled`, each by `ob:hook:ib_…` and under the same state rules as the routes (a finished task answers `task_finished`, nothing applied); a thread that is not a task answers `not_a_task`

## Out of scope
- Ending a claim (331); `complete`, `fail` and `release`, which stay with the agent holding the claim (D18).

## Notes
docs/protocol.md "Inbound endpoints" (actions `task.block`, `task.unblock`, `task.cancel`; "Fenced writes (`complete`, `fail`, `release`) stay with the agent that holds the claim"). The title's "release" is lifting a hold (`task.unblock`), not releasing a claim. Reuses 263's hold rules (`packages/core/src/tasks/hold.ts`) and 250's cancel. Holding someone else's task needs `manage` where it lives (upstream `09-access.md`), so the endpoint's `can` must include it.
