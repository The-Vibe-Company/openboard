---
id: 138
title: Refuse a second organization for a person
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - docs/auth.md
  - packages/contract/src/operations/orgs.ts
  - packages/server/src/operations/orgs.ts
  - packages/driver-sql/src/views/orgs.ts
  - packages/ports/testkit/store/orgs.test-suite.ts
  - packages/server/test/orgs.test.ts
  - packages/ports/src/store.ts
conformance: []
modes: [local]
depends_on: [137]
status: done
claimed_by: codex
issue: 139
---

## What the user does
As a person who already belongs to an organization, I cannot create another one in v1.

## Done when
- [x] the owner of `acme` creating `beta` answers 409 `already_in_org`

## Out of scope
- Accepting an invitation elsewhere (145).

## Notes
D34.
