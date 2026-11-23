---
id: 145
title: Refuse an invitation for a person who already has an organization
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
depends_on: [138, 144]
status: draft
claimed_by: null
issue: 146
---

## What the user does
As a person in one organization, I am told v1 lets me belong to only one.

## Done when
- [ ] the owner of `beta` accepting an `acme` invitation answers 409 `already_in_org`, and stays out of `acme`

## Out of scope
- An organization switcher (after v1).

## Notes
D34.
