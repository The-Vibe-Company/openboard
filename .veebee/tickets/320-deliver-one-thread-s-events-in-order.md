---
id: 320
title: Deliver one thread's events in order
milestone: M11-webhooks-and-watchers
package: server
writes:
  - packages/driver-sql/src/views/deliveries.ts
  - packages/driver-sql/src/statements.ts
  - packages/server/src/jobs/webhooks.ts
  - packages/server/test/webhooks/order.test.ts
conformance: []
modes: [local, hosted]
depends_on: [311]
status: draft
claimed_by: null
issue: null
---

## What the user does
As the owner of a receiver, I get a thread's events in the order they happened, even when an earlier one is being retried, while other threads keep flowing.

## Done when
- [ ] `bun test packages/server/test/webhooks/order.test.ts` passes on the fake clock: with a receiver failing thread A's first delivery twice, A's second and third deliveries wait until the first is `done` (or `dead`), while thread B's deliveries go out meanwhile; at most 4 deliveries of one webhook are in flight at once; events with no thread (channel created) are ordered only among themselves
- [ ] the same file passes on Postgres with two instances: neither instance sends a thread's later delivery while the other holds an earlier one's lease

## Out of scope
- At most 32 in flight per instance and per-organization caps (324); exactly-once across instances (322).

## Notes
docs/protocol.md "Delivery semantics" ("per subscription and thread, one at a time; ≤ 4 in flight per subscription"), the `deliveries_lane` index of docs/data-model.md, docs/architecture.md "Jobs any instance can take" (`FOR UPDATE SKIP LOCKED` on the pick). The pick takes only the oldest unfinished delivery of each (webhook, thread) lane. A dead delivery unblocks its lane, so one bad event cannot stop a thread forever. Run `bun run bench --quick` and say whether the pick's statement count moved.
