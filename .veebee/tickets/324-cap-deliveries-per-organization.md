---
id: 324
title: Cap deliveries per organization
milestone: M11-webhooks-and-watchers
package: server
writes:
  - packages/driver-sql/src/views/jobs/index.ts
  - packages/driver-sql/src/index.ts
  - packages/driver-postgres/src/pool.ts
  - packages/driver-sql/migrations/0048-webhook-job-indexes.sql
  - packages/server/test/webhooks/caps.test.ts
  - docs/decisions.md
  - docs/architecture.md
  - docs/data-model.md
  - docs/protocol.md
  - skills/openboard/references/webhooks.md
conformance: []
modes: [local, hosted]
depends_on: [323]
status: done
claimed_by: codex
issue: 509
---

## What the user does
As the operator of a shared instance, one organization with a flood of events cannot take every delivery slot: its deliveries wait their turn while other organizations' go out.

## Done when
- [x] `bun test packages/server/test/webhooks/caps.test.ts` passes on the fake clock: with 5,000 pending deliveries in organization A and 10 in B, B's go out in the first round; A sends at most the organization cap per minute and the rest stay `pending`, never `dead`; an instance has at most 32 deliveries in flight
- [x] the same file passes on Postgres with two instances: the organization cap holds across both (the count is shared, not per instance)

## Out of scope
- Per-board event caps (198) and webhook count quotas (304).

## Notes
docs/auth.md "SSRF and abuse through webhooks" (per-organization delivery rate caps), docs/architecture.md "SaaS seams" (webhook abuse: per-org delivery rate cap, caps on), docs/protocol.md "Delivery semantics" (≤ 32 per instance). **Proposal for the owner:** 600 deliveries per organization per minute, counted in Postgres like the † limits of docs/auth.md "Rate limits" (201's counter), recorded in docs/decisions.md and docs/architecture.md. Until the owner agrees on the number, stop with `needs-decision`. The pick skips an organization at its cap instead of leasing and putting back.
