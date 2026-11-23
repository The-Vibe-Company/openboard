---
id: 128
title: Revoke a connection
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/contract/src/operations/connections.ts
  - packages/server/src/operations/connections.ts
  - packages/driver-sql/src/views/connections.ts
  - packages/ports/testkit/store/connections.test-suite.ts
  - packages/server/test/connections.test.ts
  - packages/ports/src/store.ts
  - packages/server/test/auth/revoke.test.ts
  - docs/auth.md
  - docs/protocol.md
  - packages/contract/src/index.ts
  - packages/contract/src/operations/index.ts
  - packages/core/src/access/connections.ts
  - packages/core/src/index.ts
  - packages/driver-sql/src/views/agents.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/server/openapi.json
  - packages/server/src/operations/index.ts
  - packages/server/test/support/browser-session.ts
conformance: []
modes: [local]
depends_on: [126]
status: done
claimed_by: codex
issue: 129
---

## What the user does
As an owner, I cut a connection off, with every agent token it issued.

## Done when
- [x] `ob connections revoke <id>` makes its secret and every token claimed from it answer 401 from the next request

## Out of scope
- Child connections and their cascade: with grant-change rules (M10).
- Cross-instance cache invalidation (M6, 182).

## Notes
`docs/auth.md` "Connections" ("Revoke").
