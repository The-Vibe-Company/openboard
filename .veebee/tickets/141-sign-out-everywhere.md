---
id: 141
title: Sign out everywhere
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/server/src/auth/sessions.ts
  - packages/contract/src/operations/accounts.ts
  - packages/server/src/operations/accounts.ts
  - packages/driver-sql/src/views/accounts.ts
  - packages/ports/testkit/store/accounts.test-suite.ts
  - packages/server/test/accounts.test.ts
  - packages/ports/src/store.ts
  - packages/contract/src/index.ts
  - packages/contract/src/operations/index.ts
  - packages/server/src/operations/index.ts
  - docs/protocol.md
conformance: []
modes: [local]
depends_on: [140]
status: done
claimed_by: codex
issue: 142
---

## What the user does
As a person who lost a laptop, I end every session I have.

## Done when
- [ ] after signing in from two browsers, `POST http://127.0.0.1:8787/api/x/me/sessions/revoke-all` from one signs both out

## Out of scope
- Revoking personal tokens (159).

## Notes
`docs/protocol.md` account routes.
