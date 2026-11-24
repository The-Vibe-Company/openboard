---
id: 204
title: Rate-limit invitations per organization
milestone: M7-hosted-deploy
package: server
writes:
  - packages/server/src/operations/invitations.ts
  - packages/server/test/ha/invitation-limit.test.ts
conformance: []
modes: [local, hosted]
depends_on: [201]
status: draft
claimed_by: null
issue: 365
---

## What the user does
As the operator of a shared instance, an organization creating invitation links in a loop is stopped after 50 a day, on every instance.

## Done when
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/ha/invitation-limit.test.ts` passes, requests alternating between two instances: an organization's 51st invitation within a day answers 429 `rate_limited` with a `retry-after` and creates no link, another organization still invites, and invitations pass again the next window
- [ ] the same file passes on SQLite: `bun test packages/server/test/ha/invitation-limit.test.ts`

## Out of scope
- Members per organization, a count quota (196).
- Email invitations (Q4).

## Notes
- docs/auth.md "Rate limits" († invitations per organization: 50/day). Use the organization-level counter 201 landed (`takeRate` on `ctx.org`), before the organization-locked write in `createInvitationHandler` (`packages/server/src/operations/invitations.ts`). A revoked invitation still counts.
