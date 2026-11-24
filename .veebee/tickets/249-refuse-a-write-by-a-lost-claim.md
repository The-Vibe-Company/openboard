---
id: 249
title: Refuse a write by a lost claim
milestone: M9-tasks
package: server
writes:
  - packages/core/src/tasks/fence.ts
  - packages/core/test/tasks/fence.test.ts
  - packages/core/src/tasks/settle.ts
  - packages/core/src/tasks/release.ts
  - packages/core/src/tasks/claim.ts
  - packages/server/src/operations/task-claims.ts
  - packages/server/test/tasks/fencing.test.ts
  - packages/core/src/tasks/renew.ts
  - packages/server/src/operations/tasks/claim-proof.ts
  - packages/server/src/operations/tasks/complete.ts
  - packages/server/src/operations/tasks/release.ts
  - packages/server/src/operations/tasks/renew.ts
  - docs/protocol.md
conformance: []
modes: [local, hosted]
depends_on: [248]
status: done
claimed_by: codex
issue: 422
---

## What the user does
As an agent whose claim ran out or was taken over, my late write changes nothing, so two agents never settle one task.

## Done when
- [ ] `bun test packages/server/test/tasks/fencing.test.ts` passes: renew, release, complete and fail with a wrong token, an older epoch, after a release, or past the lease each answer 409 `claim_lost` and leave the task, its labels and the feed as they were; tokens are compared by their hashes in constant time
- [ ] `bun test packages/core/test/tasks/fence.test.ts` passes, every claim write going through one check in `packages/core/src/tasks/fence.ts`

## Out of scope
- Upstream's fencing check ends by reopening the failed task: 251 records it (`.veebee/cut.md` moved the `[c]`).
- A hold by the claim, which ends it (262).

## Notes
docs/data-model.md "Claims, leases, and dependencies" ("Fencing: `epoch`, `sha256(token)` (constant time), live lease, else 409 `claim_lost`"); upstream "A claim's writes are fenced".
