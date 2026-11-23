---
id: 136
title: Refuse a reserved organization slug
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/contract/src/operations/orgs.ts
  - packages/server/src/operations/orgs.ts
  - packages/driver-sql/src/views/orgs.ts
  - packages/ports/testkit/store/orgs.test-suite.ts
  - packages/server/test/orgs.test.ts
  - packages/ports/src/store.ts
  - packages/server/src/http/scope.ts
  - packages/server/src/http/pipeline.ts
  - packages/server/src/operations/index.ts
conformance: []
modes: [local]
depends_on: [134]
status: done
claimed_by: codex
issue: 137
---

## What the user does
As a person creating an organization, I cannot take a name the board's own pages use.

## Done when
- [x] creating an organization with slug `api`, `settings` or `x` answers 400 `reserved_slug`

## Out of scope
- Taken slugs (137).

## Notes
Reserved list: `docs/protocol.md` "URLs".
