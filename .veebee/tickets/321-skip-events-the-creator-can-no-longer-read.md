---
id: 321
title: Skip events the creator can no longer read
milestone: M11-webhooks-and-watchers
package: server
writes:
  - packages/server/src/jobs/webhooks.ts
  - packages/server/src/webhooks/send.ts
  - packages/ports/src/webhooks/index.ts
  - packages/contract/src/entities/webhooks/index.ts
  - packages/contract/src/operations/audit.ts
  - packages/core/src/webhooks/events.ts
  - packages/core/src/access/oidc-claims.ts
  - packages/core/src/index.ts
  - packages/server/openapi.json
  - skills/openboard/references/webhooks.md
  - docs/data-model.md
  - packages/driver-sql/migrations/0040-webhook-workload.sql
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/views/webhooks/deliveries.ts
  - packages/driver-sql/src/views/webhooks/webhooks.ts
  - packages/server/src/auth/oidc.ts
  - packages/server/src/operations/webhooks/index.ts
  - docs/protocol.md
  - docs/decisions.md
  - packages/server/test/webhooks/creator-access.test.ts
conformance: []
modes: [local, hosted]
depends_on: [281, 320]
status: done
claimed_by: codex
issue: 506
---

## What the user does
As a board owner, a webhook never sends an event its creator could not read at that moment, and one whose creator left loses its access instead of leaking the board.

## Done when
- [ ] `bun test packages/server/test/webhooks/creator-access.test.ts` passes: after a grant change takes `read` on `dev/secret` from the creator, an event there is marked `skipped` and not sent, while events in `dev/` still go out; when the creator can no longer manage what the filter matches (grant revoked, member removed, connection revoked) the webhook is disabled with `disabledReason: "creator_access"` and `ob.webhook.disabled`; a creator's access is read at send time, not when the event was written

- [ ] The same test command verifies that an OIDC-created webhook stores only the verified identity used by matching grants, re-evaluates current grants at delivery, and disables a legacy OIDC webhook without that identity using `creator_unverifiable`.

## Out of scope
- Watchers, whose pull already applies the caller's access (300).

## Notes
docs/protocol.md "Subscription" ("deliveries re-check the creator's read access at send time (unreadable events are skipped); a creator that loses access disables it"), D15, docs/auth.md "SSRF and abuse through webhooks". The creator is `owner_actor`/`owner` on the webhook row (304); resolve their current `can` with 281's resolver (`packages/core/src/access/resolve.ts`) as the pipeline does for a request, once per batch of deliveries, not per event.
