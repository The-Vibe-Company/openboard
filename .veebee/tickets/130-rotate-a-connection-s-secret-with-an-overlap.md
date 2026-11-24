---
id: 130
title: Rotate a connection's secret with an overlap
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/contract/src/operations/connections.ts
  - packages/server/src/operations/connections.ts
  - packages/driver-sql/src/views/connections.ts
  - packages/ports/testkit/store/connections.test-suite.ts
  - packages/server/test/connections.test.ts
  - packages/ports/src/store.ts
  - packages/server/src/auth/connections.ts
  - packages/server/test/auth/rotate.test.ts
  - packages/core/src/access/connections.ts
  - packages/core/src/index.ts
  - packages/core/test/access/connections.test.ts
  - packages/contract/src/index.ts
  - packages/contract/src/operations/index.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/server/src/auth/chain.ts
  - packages/server/src/operations/index.ts
  - packages/server/openapi.json
  - packages/cli/src/commands/connections.ts
  - packages/cli/src/commands/rotate.ts
  - packages/cli/src/commands/index.ts
  - packages/cli/src/main.ts
  - packages/cli/test/connections.test.ts
  - docs/auth.md
  - docs/protocol.md
  - docs/data-model.md
conformance: []
modes: [local]
depends_on: [127, 129]
status: done
claimed_by: claude-t130
issue: 131
---

## What the user does
As an owner, I replace a secret without breaking the agents that still use the old one for a while.

## Done when
- [x] `ob connections rotate <id> --overlap 10m --secret-file new.secret` writes a new secret; both secrets work for ten minutes, then only the new one

## Out of scope
- Claimed tokens, which are unaffected.

## Notes
`docs/auth.md` "Connections" ("Rotate", overlap ≤ 24 h).
