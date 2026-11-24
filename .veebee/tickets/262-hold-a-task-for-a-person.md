---
id: 262
title: Hold a task for a person
milestone: M9-tasks
package: server
writes:
  - packages/contract/src/operations/task-holds.ts
  - packages/contract/src/operations/index.ts
  - packages/core/src/tasks/hold.ts
  - packages/core/test/tasks/hold.test.ts
  - packages/core/src/tasks/expire.ts
  - packages/contract/src/entities/task-events.ts
  - packages/core/src/tasks/events.ts
  - packages/driver-sql/src/views/task-folds.ts
  - packages/driver-sql/src/statements.ts
  - packages/server/src/operations/task-holds.ts
  - packages/server/src/operations/index.ts
  - packages/server/test/tasks/hold.test.ts
  - packages/server/test/isolation/cases.ts
  - packages/cli/src/commands/tasks.ts
  - packages/cli/src/claims.ts
  - packages/cli/test/tasks.test.ts
conformance: []
modes: [local, hosted]
depends_on: [261]
status: draft
claimed_by: null
issue: 436
---

## What the user does
As an agent or the task's owner, I hold a task for someone's decision, `ob tasks block 2 "approve the migration?" --kind awaiting_approval`, so no one claims it meanwhile.

## Done when
- [ ] `ob tasks block 2 "approve?" --kind awaiting_approval` prints `blocked 2`; `ob read 2 --json` shows `state: "blocked"`, `blocked: { kind: "awaiting_approval", reason: "approve?" }` and `board.task` `blocked`; `ob tasks claim 2` prints `error: task_blocked: …`
- [ ] while 3 is claimed, `ob tasks block 3 "which one?"` by anyone but the claim's holder prints `error: task_claimed: …`; the holder's `ob tasks block 3 "which one?" --kind needs_input` holds it and ends the claim, so its `ob tasks complete 3` then prints `error: claim_lost: …`; `--kind edited` prints `error: invalid_request: …`

## Out of scope
- Lifting a hold, and upstream's hold check (263).
- The board's own hold when someone else edits a task's root (272).

## Notes
- Upstream `POST /tasks/:id/block { reason, kind?, epoch?, token? }`: a claimed task needs its claim (fenced, 249); otherwise the owner's rule (250). `kind` is any name of up to 64 characters but `edited`, the board's own: export the hold rule so 272 holds with `edited` without editing `core/tasks/hold.ts`.
- A held task's lease running out returns it to `blocked` (`task.expired` fold in docs/data-model.md), in `core/tasks/expire.ts`.
- Depends on 261, not 249 as first cut: holds and needs share the readiness rule, and upstream's checks of either use both.
