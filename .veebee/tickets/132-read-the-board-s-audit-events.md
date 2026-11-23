---
id: 132
title: Read the board's audit events
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/contract/src/operations/audit.ts
  - packages/server/src/operations/audit.ts
  - packages/driver-sql/src/views/audit.ts
  - packages/ports/testkit/store/audit.test-suite.ts
  - packages/server/test/audit.test.ts
  - packages/ports/src/store.ts
conformance: []
modes: [local]
depends_on: [98, 131]
status: draft
claimed_by: null
issue: 133
---

## What the user does
As an owner, I see who changed my board's configuration and when.

## Done when
- [ ] `curl http://127.0.0.1:8787/api/local/main/x/audit` as the owner lists `ob.connection.created`, `ob.agent.claimed` and `ob.connection.revoked` with their actors and no secret, while `GET /events` shows none of them

## Out of scope
- Organization audit (161).

## Notes
`docs/auth.md` "Audit"; D23; enforced from M4 (`docs/codebase.md` 4.5).
