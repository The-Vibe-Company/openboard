---
id: 131
title: List the connections I manage
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/contract/src/operations/connections.ts
  - packages/server/src/operations/connections.ts
  - packages/driver-sql/src/views/connections.ts
  - packages/ports/testkit/store/connections.test-suite.ts
  - packages/server/test/connections.test.ts
  - packages/ports/src/store.ts
  - packages/contract/src/entities/connections.ts
  - packages/contract/src/operations/index.ts
  - packages/contract/src/index.ts
  - packages/server/src/operations/index.ts
  - packages/server/openapi.json
  - packages/server/test/auth/rotate.test.ts
  - packages/driver-sql/migrations/0009-connection-use.sql
  - packages/driver-sql/src/index.ts
  - packages/driver-sqlite/test/open.test.ts
  - packages/cli/src/output.ts
  - packages/cli/test/connections.test.ts
  - docs/auth.md
  - docs/protocol.md
  - docs/data-model.md
  - docs/decisions.md
conformance: []
modes: [local]
depends_on: [130]
status: done
claimed_by: claude-t131
issue: 132
---

## What the user does
As an owner, I see every connection on my board with its agents, and never a secret.

## Done when
- [x] `ob connections` lists each connection with its agents, last use and secret hint, and its output contains no `obc_` or `obt_` value

## Out of scope
- The settings page (M8, 234).

## Notes
`docs/protocol.md` board extensions (`GET /x/connections`, `/x/connections/:id`).
