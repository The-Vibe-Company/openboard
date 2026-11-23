---
id: 125
title: Refuse a claim for a profile a live agent holds
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/contract/src/operations/connections.ts
  - packages/server/src/operations/connections.ts
  - packages/driver-sql/src/views/connections.ts
  - packages/ports/testkit/store/connections.test-suite.ts
  - packages/server/test/connections.test.ts
  - packages/ports/src/store.ts
  - packages/server/test/auth/profile-taken.test.ts
  - packages/core/src/access/agents.ts
  - packages/core/test/access/agents.test.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/server/openapi.json
  - docs/auth.md
  - docs/data-model.md
  - docs/decisions.md
conformance: []
modes: [local]
depends_on: [124]
status: done
claimed_by: claude-opus-t125
issue: 126
---

## What the user does
As an orchestrator, two sandboxes cannot end up writing under the same name.

## Done when
- [x] claiming `fixer-2` twice without an `idempotencyKey` answers 409 `profile_taken` the second time

## Out of scope
- Retries with the same key (126).

## Notes
`docs/auth.md` mode 2 ("Profile collisions").
