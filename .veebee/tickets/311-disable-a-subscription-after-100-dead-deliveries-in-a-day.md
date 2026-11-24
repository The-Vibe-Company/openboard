---
id: 311
title: Disable a subscription after 100 dead deliveries in a day
milestone: M11-webhooks-and-watchers
package: server
writes:
  - .veebee/tickets/311-disable-a-subscription-after-100-dead-deliveries-in-a-day.md
  - docs/data-model.md
  - docs/protocol.md
  - packages/contract/src/operations/audit.ts
  - packages/core/src/index.ts
  - packages/core/src/webhooks/events.ts
  - packages/core/src/webhooks/outcome.ts
  - packages/core/test/webhooks/outcome.test.ts
  - packages/driver-sql/migrations/0038-webhook-recent-dead.sql
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/views/jobs/index.ts
  - packages/driver-sql/src/views/webhooks/deliveries.ts
  - packages/driver-sql/src/views/webhooks/webhooks.ts
  - packages/ports/src/webhooks/index.ts
  - packages/ports/testkit/isolation-case-seeds.ts
  - packages/ports/testkit/isolation-webhooks.ts
  - packages/ports/testkit/store/webhooks.test-suite.ts
  - packages/server/openapi.json
  - packages/server/src/jobs/webhooks.ts
  - packages/server/src/operations/audit.ts
  - packages/server/test/webhooks/dead-disable.test.ts
  - skills/openboard/references/webhooks.md
conformance: []
modes: [local, hosted]
depends_on: [310]
status: done
claimed_by: codex
issue: 496
---

## What the user does
As the operator, a subscription whose receiver rejects everything stops being called after 100 dead deliveries in 24 hours, instead of burning attempts forever.

## Done when
- [x] `bun test packages/server/test/webhooks/dead-disable.test.ts` passes on the fake clock: the 101st delivery to go `dead` within 24 hours disables the webhook with `disabledReason: "dead_deliveries"` and appends `ob.webhook.disabled`; 100 dead in a day leaves it on, and dead deliveries older than 24 hours do not count; pings (306) never count
- [x] the same file passes on Postgres with two instances, each marking deliveries dead: the count holds across instances and the webhook is disabled once

## Out of scope
- Alerting anyone (the operator's metrics, M15, 394).

## Notes
docs/protocol.md "Delivery semantics" ("more than 100 dead in 24 h disables it"), docs/auth.md "SSRF and abuse through webhooks" (dead letters disable a subscription). Count with one indexed statement over `webhook_deliveries` (state, `done_at`) when a delivery dies, in the same transaction that marks it, so two instances cannot both miss the threshold.
