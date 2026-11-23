---
id: 137
title: Refuse a taken organization slug
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/contract/src/operations/orgs.ts
  - packages/server/src/operations/orgs.ts
  - packages/driver-sql/src/views/orgs.ts
  - packages/ports/testkit/store/orgs.test-suite.ts
  - packages/server/test/orgs.test.ts
  - packages/ports/src/store.ts
conformance: []
modes: [local]
depends_on: [136]
status: done
claimed_by: codex
issue: 138
---

## What the user does
As a person creating an organization, I am told the name is already used.

## Done when
- [x] a second person creating `acme` answers 409 `slug_taken`

## Out of scope
- Renaming: slugs are immutable in v1 (Q7).

## Notes
`docs/protocol.md` "Error envelope".
