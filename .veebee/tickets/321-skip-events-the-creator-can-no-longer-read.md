---
id: 321
title: Skip events the creator can no longer read
milestone: M11-webhooks-and-watchers
package: server
writes:
  - packages/server/src/jobs/webhooks.ts
  - packages/driver-sql/src/views/webhooks.ts
  - packages/server/test/webhooks/creator-access.test.ts
conformance: []
modes: [local, hosted]
depends_on: [281, 320]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a board owner, a webhook never sends an event its creator could not read at that moment, and one whose creator left loses its access instead of leaking the board.

## Done when
- [ ] `bun test packages/server/test/webhooks/creator-access.test.ts` passes: after a grant change takes `read` on `dev/secret` from the creator, an event there is marked `skipped` and not sent, while events in `dev/` still go out; when the creator can no longer manage what the filter matches (grant revoked, member removed, connection revoked) the webhook is disabled with `disabledReason: "creator_access"` and `ob.webhook.disabled`; a creator's access is read at send time, not when the event was written

## Out of scope
- Watchers, whose pull already applies the caller's access (300).

## Notes
docs/protocol.md "Subscription" ("deliveries re-check the creator's read access at send time (unreadable events are skipped); a creator that loses access disables it"), D15, docs/auth.md "SSRF and abuse through webhooks". The creator is `owner_actor`/`owner` on the webhook row (304); resolve their current `can` with 281's resolver (`packages/core/src/access/resolve.ts`) as the pipeline does for a request, once per batch of deliveries, not per event.
