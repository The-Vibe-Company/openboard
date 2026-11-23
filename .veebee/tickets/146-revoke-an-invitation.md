---
id: 146
title: Revoke an invitation
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
depends_on: [145]
status: draft
claimed_by: null
issue: 147
---

## What the user does
As an admin, I withdraw a link I shared by mistake.

## Done when
- [ ] `POST http://127.0.0.1:8787/api/x/orgs/acme/invitations/<id>/revoke` makes accepting it answer 410 `invitation_used`

## Out of scope
- Used and expired links (147).

## Notes
`docs/auth.md` "Invitations".
