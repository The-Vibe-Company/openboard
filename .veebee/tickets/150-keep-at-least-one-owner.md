---
id: 150
title: Keep at least one owner
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/contract/src/operations/memberships.ts
  - packages/server/src/operations/memberships.ts
  - packages/driver-sql/src/views/memberships.ts
  - packages/ports/testkit/store/memberships.test-suite.ts
  - packages/server/test/memberships.test.ts
  - packages/ports/src/store.ts
  - packages/core/src/orgs/roles.ts
  - packages/core/test/orgs/roles.test.ts
conformance: []
modes: [local]
depends_on: [149]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an organization, I can never be left without an owner.

## Done when
- [ ] demoting or removing the only owner is refused, and the organization still lists them as `owner`

## Out of scope
- Transferring ownership: promote another owner first.

## Notes
The refusal's code is not specified (`.veebee/cut.md` "Could not place").
