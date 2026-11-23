---
id: 122
title: Refresh a claimed token
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
  - packages/server/test/auth/refresh.test.ts
conformance: []
modes: [local]
depends_on: [121]
status: draft
claimed_by: null
issue: 123
---

## What the user does
As an agent, I renew my token before it expires, within the limit my connection set.

## Done when
- [ ] `curl -X POST http://127.0.0.1:8787/api/local/main/x/connections/refresh -H "authorization: Bearer <obt_>"` answers a new token with a later `expiresAt`, never past `hardExpiresAt`
- [ ] the old token keeps working for 60 seconds, then answers 401

## Out of scope
- Refresh rate limits (M7, 202).

## Notes
`docs/auth.md` mode 2 ("Refresh").
