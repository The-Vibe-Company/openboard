---
id: 309
title: Re-send a dead delivery
milestone: M11-webhooks-and-watchers
package: server
writes:
  - packages/contract/src/operations/webhook-deliveries.ts
  - packages/server/src/operations/webhook-deliveries.ts
  - packages/driver-sql/src/views/deliveries.ts
  - packages/server/test/webhooks/resend.test.ts
conformance: []
modes: [local, hosted]
depends_on: [308]
status: draft
claimed_by: null
issue: 494
---

## What the user does
As a board admin whose receiver is fixed, I run `ob webhooks retry <id> <delivery>` and the dead delivery goes out again with its original ID.

## Done when
- [ ] `bun test packages/server/test/webhooks/resend.test.ts` passes: `POST /x/webhooks/:id/deliveries/:dl/retry` on a `dead` delivery makes it `pending` with a fresh attempt schedule and the same `dl_` ID, and the next run sends it; on a `pending`, `sending` or `done` delivery it answers 400 `invalid_request` "only a dead delivery is sent again"; a delivery of another webhook or board answers 404 `not_found`; it needs the same access as managing the webhook
- [ ] `ob webhooks retry <id> <dl>` prints `queued dl_…`

## Out of scope
- Re-sending every dead delivery at once (not in the cut); re-enabling a disabled webhook (310).

## Notes
docs/protocol.md "Dead letters" ("listed and retried through the deliveries routes") and `POST /x/webhooks/:id/deliveries/:dl/retry`. A re-send keeps `delivery.id`, so a receiver that did get it before still dedupes; `delivery.attempt` restarts at 1. A re-send of a delivery whose webhook is disabled stays `pending` until it is enabled again.
