---
id: 117
title: Claim an agent token with a connection secret
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/contract/src/operations/connections.ts
  - packages/server/src/operations/connections.ts
  - packages/driver-sql/src/views/connections.ts
  - packages/ports/testkit/store/connections.test-suite.ts
  - packages/server/test/connections.test.ts
  - packages/ports/src/store.ts
  - packages/server/src/auth/tokens.ts
  - packages/server/src/auth/chain.ts
  - packages/driver-sql/migrations/*-agents.sql
  - packages/server/test/auth/claim.test.ts
  - packages/contract/src/entities/connections.ts
  - packages/contract/src/entities/actors.ts
  - packages/contract/src/operations/index.ts
  - packages/contract/src/index.ts
  - packages/core/src/access/agents.ts
  - packages/core/src/index.ts
  - packages/core/test/access/agents.test.ts
  - packages/driver-sql/src/views/agents.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/driver-sql/src/statements.ts
  - packages/driver-sql/src/index.ts
  - packages/server/src/auth/connections.ts
  - packages/server/src/auth/local-owner.ts
  - packages/server/src/deps.ts
  - packages/server/src/http/pipeline.ts
  - packages/server/src/operations/index.ts
  - packages/server/src/operations/actors.ts
  - packages/server/openapi.json
  - packages/ports/src/index.ts
  - packages/driver-sqlite/test/open.test.ts
  - packages/cli/src/commands/connections.ts
  - packages/cli/test/connections.test.ts
  - docs/data-model.md
conformance: []
modes: [local]
depends_on: [112]
status: done
claimed_by: claude-opus-t117
issue: 117
---

## What the user does
As an orchestrator, I trade the connection secret for a short-lived token pinned to one profile.

## Done when
- [x] for `fixers` created with `--profiles 'fixer-*'` and without `--direct`, `curl -X POST http://127.0.0.1:8787/api/local/main/x/connections/claim -H "authorization: Bearer $(cat fixers.secret)" -d '{"profile":"fixer-2"}'` answers an `agent`, an `obt_` token and `env`
- [x] `BOARD_TOKEN=<that obt_> ob post dev hi` shows `fixer-2 via fixers`

## Out of scope
- The CLI (118); pins (119, 120); refresh (122); single use (124).

## Notes
`docs/auth.md` "Three ways to connect", mode 2.
