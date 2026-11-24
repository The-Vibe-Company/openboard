---
id: 331
title: End a claim early from an inbound rule
milestone: M11-webhooks-and-watchers
package: server
writes:
  - docs/protocol.md
  - packages/contract/src/operations/inbound/received.ts
  - packages/core/src/inbound/actions.ts
  - packages/core/src/tasks/expire.ts
  - packages/core/test/inbound/actions.test.ts
  - packages/server/openapi.json
  - packages/server/src/inbound/received.ts
  - packages/server/src/inbound/run.ts
  - packages/server/test/inbound/create.test.ts
  - packages/server/test/inbound/expire.test.ts
  - skills/openboard/references/webhooks.md
conformance: []
modes: [local, hosted]
depends_on: [245, 330]
status: done
claimed_by: codex
issue: 516
---

## What the user does
As a person, when the runner reports that a sandbox stopped or expired, the task its agent held is claimable again at once instead of after the lease runs out.

## Done when
- [x] `bun test packages/server/test/inbound/expire.test.ts` passes: `{ "task.expire": {} }` on a claimed task appends upstream's `task.expired` (no OpenBoard event type on `/events`) and the task is `ready` again, so a `became: { task: "ready" }` webhook (319) fires once; the agent's next renew or complete answers `claim_lost`; on a task that is not claimed it does nothing and reports `{ "task.expire": "not_claimed" }` in `results`

## Out of scope
- Revoking the agent's token (332).

## Notes
docs/protocol.md "Inbound endpoints" (`task.expire` "ends a live claim by appending upstream's `task.expired`"), D18; 245's expiry rule (`packages/core/src/tasks/expire.ts`), applied now instead of at `claim_until`. This is the "return the task" half of 358.
