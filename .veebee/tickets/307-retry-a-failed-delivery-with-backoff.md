---
id: 307
title: Retry a failed delivery with backoff
milestone: M11-webhooks-and-watchers
package: core
writes:
  - packages/core/src/webhooks/outcome.ts
  - packages/core/test/webhooks/outcome.test.ts
  - packages/driver-sql/src/views/deliveries.ts
  - packages/server/src/jobs/webhooks.ts
  - packages/server/test/webhooks/retry.test.ts
conformance: []
modes: [local, hosted]
depends_on: [306]
status: draft
claimed_by: null
issue: null
---

## What the user does
As the owner of a receiver that was down for a few minutes, I get the deliveries I missed once it is back, with the same delivery IDs, so I can dedupe.

## Done when
- [ ] `bun test packages/core/test/webhooks/outcome.test.ts` passes: a network error, a timeout, 408, 425, 429 and any 5xx retry after 10 s, 30 s, 2 min, 10 min, 30 min, 1 h, 3 h, 6 h, 12 h; a `retry-after` up to 1 h replaces the next wait; any other 4xx is dead at once; 2xx within 10 s is done
- [ ] `bun test packages/server/test/webhooks/retry.test.ts` passes on the fake clock: a receiver answering 503 twice then 200 receives three POSTs with the same `webhook-id` and body, `delivery.attempt` 1, 2, 3, 10 s then 30 s apart, and the delivery ends `done`; no attempt runs before it is due; the same file passes on Postgres

## Out of scope
- What happens after the last attempt (308); 410 (310); per-thread order (320).

## Notes
docs/protocol.md "Delivery semantics" (outcomes and schedule); `next_at`, `attempt`, `last_status`, `last_error` in docs/data-model.md `webhook_deliveries`. `delivery.id` is stable across retries and `delivery.attempt` counts them; the signature is computed per attempt with that attempt's timestamp. Depends on 306, which also changes `jobs/webhooks.ts` and `views/deliveries.ts`.
