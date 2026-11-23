---
id: 140
title: Sign out
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
  - packages/server/src/http/pipeline.ts
conformance: []
modes: [local]
depends_on: [139]
status: claimed
claimed_by: claude-opus-5-5
issue: 141
---

## What the user does
As a person, I end my session.

## Done when
- [ ] `curl -b cookies -H 'x-ob-csrf: …' -X POST http://127.0.0.1:8787/auth/logout` ends the session, and `http://127.0.0.1:8787/api/x/session` then answers signed out

## Out of scope
- Signing out everywhere (141).

## Notes
`docs/auth.md` "Sessions and CSRF".
