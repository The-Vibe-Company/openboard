---
id: 309
title: Re-send a dead delivery
milestone: M11-webhooks-and-watchers
package: server
writes:
  - docs/decisions.md
  - docs/protocol.md
  - packages/cli/src/output.ts
  - packages/contract/src/index.ts
  - packages/contract/src/operations/index.ts
  - packages/contract/src/operations/webhooks/deliveries.ts
  - packages/driver-sql/src/views/jobs/index.ts
  - packages/driver-sql/src/views/webhooks/deliveries.ts
  - packages/driver-sql/src/views/webhooks/webhooks.ts
  - packages/ports/src/webhooks/index.ts
  - packages/ports/testkit/isolation.test-suite.ts
  - packages/server/openapi.json
  - packages/server/src/app.ts
  - packages/server/src/jobs/webhooks.ts
  - packages/server/src/operations/index.ts
  - packages/server/src/operations/webhooks/deliveries.ts
  - packages/server/src/webhooks/request.ts
  - packages/server/test/isolation/seed.ts
  - packages/server/test/webhooks/resend.test.ts
  - skills/openboard/SKILL.md
  - skills/openboard/references/commands.md
conformance: []
modes: [local, hosted]
depends_on: [308]
status: done
claimed_by: codex-309
issue: 494
---

## What the user does
As a board admin whose receiver is fixed, I run `ob webhooks retry <id> <delivery>` and the dead delivery goes out again with its original ID.

## Done when
- [x] `bun test packages/server/test/webhooks/resend.test.ts` passes: `POST /x/webhooks/:id/deliveries/:dl/retry` on a `dead` delivery makes it `pending` with a fresh attempt schedule and the same `dl_` ID, and the next run sends it; on a `pending`, `sending` or `done` delivery it answers 400 `invalid_request` "only a dead delivery is sent again"; a delivery of another webhook or board answers 404 `not_found`; it needs the same access as managing the webhook
- [x] `ob webhooks retry <id> <dl>` prints `queued dl_…`

## Out of scope
- Re-sending every dead delivery at once (not in the cut); re-enabling a disabled webhook (310).

## Notes
docs/protocol.md "Dead letters" ("listed and retried through the deliveries routes") and `POST /x/webhooks/:id/deliveries/:dl/retry`. A re-send keeps `delivery.id`, so a receiver that did get it before still dedupes; `delivery.attempt` restarts at 1. A re-send of a delivery whose webhook is disabled stays `pending` until it is enabled again.
