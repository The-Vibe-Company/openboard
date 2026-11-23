---
id: 148
title: Bind an invitation to a verified email
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
depends_on: [147]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an admin, I make sure only the person I invited can use the link.

## Done when
- [ ] an invitation created with `"email": "ada@example.com"` is refused to a person whose verified GitHub email differs, and accepted by Ada

## Out of scope
- Sending the email (Q4).

## Notes
The refusal's status and code are not specified (`.veebee/cut.md` "Could not place").
