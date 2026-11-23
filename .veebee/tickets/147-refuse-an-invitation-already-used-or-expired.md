---
id: 147
title: Refuse an invitation already used or expired
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/contract/src/operations/invitations.ts
  - packages/server/src/operations/invitations.ts
  - packages/driver-sql/src/views/invitations.ts
  - packages/ports/testkit/store/invitations.test-suite.ts
  - packages/server/test/invitations.test.ts
  - packages/ports/src/store.ts
conformance: []
modes: [local]
depends_on: [146]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an admin, a link works once and for seven days only.

## Done when
- [ ] accepting an invitation a second time answers 410 `invitation_used`, and so does accepting one created more than seven days ago

## Out of scope
- Email binding (148).

## Notes
Single use, 7 days (`docs/auth.md` "Invitations").
