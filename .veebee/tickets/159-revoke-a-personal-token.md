---
id: 159
title: Revoke a personal token
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/contract/src/operations/accounts.ts
  - packages/server/src/operations/accounts.ts
  - packages/driver-sql/src/views/accounts.ts
  - packages/ports/testkit/store/accounts.test-suite.ts
  - packages/server/test/accounts.test.ts
  - packages/ports/src/store.ts
  - packages/server/test/auth/personal-token.test.ts
conformance: []
modes: [local]
depends_on: [156]
status: draft
claimed_by: null
issue: 160
---

## What the user does
As a person, I cut off the CLI on a machine I no longer trust.

## Done when
- [ ] `curl -b cookies http://127.0.0.1:8787/api/x/tokens` lists the CLI's token, and `POST http://127.0.0.1:8787/api/x/tokens/<id>/revoke` makes `ob whoami` there print `error: unauthorized`

## Out of scope
- The `/account` page (M8).

## Notes
`docs/protocol.md` account routes.
