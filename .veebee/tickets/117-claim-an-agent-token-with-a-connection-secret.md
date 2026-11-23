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
conformance: []
modes: [local]
depends_on: [112]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an orchestrator, I trade the connection secret for a short-lived token pinned to one profile.

## Done when
- [ ] for `fixers` created with `--profiles 'fixer-*'` and without `--direct`, `curl -X POST http://127.0.0.1:8787/api/local/main/x/connections/claim -H "authorization: Bearer $(cat fixers.secret)" -d '{"profile":"fixer-2"}'` answers an `agent`, an `obt_` token and `env`
- [ ] `BOARD_TOKEN=<that obt_> ob post dev hi` shows `fixer-2 via fixers`

## Out of scope
- The CLI (118); pins (119, 120); refresh (122); single use (124).

## Notes
`docs/auth.md` "Three ways to connect", mode 2.
