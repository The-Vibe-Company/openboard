---
id: 126
title: Return the same agent for a repeated claim key
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/contract/src/operations/connections.ts
  - packages/server/src/operations/connections.ts
  - packages/driver-sql/src/views/connections.ts
  - packages/ports/testkit/store/connections.test-suite.ts
  - packages/server/test/connections.test.ts
  - packages/ports/src/store.ts
  - packages/server/test/auth/claim-key.test.ts
conformance: []
modes: [local]
depends_on: [125]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an orchestrator that retries a launch, my second claim does not create a second agent.

## Done when
- [ ] two claims of `fixer-2` with `"idempotencyKey": "sbx-1"` both succeed and return the same agent ID

## Out of scope
- Per-agent revoke (129).

## Notes
`docs/auth.md` mode 2.
