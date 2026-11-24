---
id: 159
title: Revoke a personal token
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - .veebee/tickets/159-revoke-a-personal-token.md
  - docs/auth.md
  - docs/protocol.md
  - packages/contract/src/entities/accounts.ts
  - packages/contract/src/index.ts
  - packages/contract/src/operations/index.ts
  - packages/server/src/operations/index.ts
  - packages/server/openapi.json
  - packages/sdk/src/client.ts
  - packages/cli/test/login.test.ts
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
status: done
claimed_by: codex-t159
issue: 160
---

## What the user does
As a person, I cut off the CLI on a machine I no longer trust.

## Done when
- [x] `curl -b cookies http://127.0.0.1:8787/api/x/tokens` lists the CLI's token, and `POST http://127.0.0.1:8787/api/x/tokens/<id>/revoke` makes `ob whoami` there print `error: unauthorized`

## Out of scope
- The `/account` page (M8).

## Notes
`docs/protocol.md` account routes.
