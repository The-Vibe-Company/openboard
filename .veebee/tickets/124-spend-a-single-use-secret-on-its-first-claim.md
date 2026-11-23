---
id: 124
title: Spend a single-use secret on its first claim
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/contract/src/operations/connections.ts
  - packages/server/src/operations/connections.ts
  - packages/driver-sql/src/views/connections.ts
  - packages/ports/testkit/store/connections.test-suite.ts
  - packages/server/test/connections.test.ts
  - packages/ports/src/store.ts
  - packages/server/test/auth/single-use.test.ts
conformance: []
modes: [local]
depends_on: [123]
status: draft
claimed_by: null
issue: 125
---

## What the user does
As an orchestrator, a secret minted for one sandbox is useless once claimed.

## Done when
- [ ] for a connection created with `--claims 1`, the first claim answers a token and the second answers 410 `secret_spent`

## Out of scope
- Profile collisions (125).

## Notes
Spent in the claim's transaction (`docs/auth.md` mode 2).
