---
id: 149
title: Change a member's role
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/contract/src/operations/memberships.ts
  - packages/server/src/operations/memberships.ts
  - packages/driver-sql/src/views/memberships.ts
  - packages/ports/testkit/store/memberships.test-suite.ts
  - packages/server/test/memberships.test.ts
  - packages/ports/src/store.ts
  - packages/core/src/orgs/roles.ts
  - packages/core/test/orgs/roles.test.ts
  - docs/protocol.md
  - packages/contract/src/index.ts
  - packages/contract/src/operations/index.ts
  - packages/core/src/index.ts
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/statements.ts
  - packages/driver-sql/src/views/invitations.ts
  - packages/ports/testkit/index.ts
  - packages/server/openapi.json
  - packages/server/src/operations/index.ts
  - packages/server/test/invitations.test.ts
  - packages/server/test/support/browser-session.ts
conformance: []
modes: [local]
depends_on: [144]
status: done
claimed_by: Codex
issue: 150
---

## What the user does
As an organization admin, I make a member an admin, or back.

## Done when
- [x] `POST http://127.0.0.1:8787/api/x/orgs/acme/members/<user>/role {"role":"admin"}` by the owner makes them admin; the same call by a member answers 403 `forbidden`

## Out of scope
- The last owner (150).

## Notes
Roles table in `docs/auth.md` "Organizations, boards, people".
