---
id: 143
title: Invite someone by link
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/contract/src/operations/invitations.ts
  - packages/server/src/operations/invitations.ts
  - packages/driver-sql/src/views/invitations.ts
  - packages/ports/testkit/store/invitations.test-suite.ts
  - packages/server/test/invitations.test.ts
  - packages/ports/src/store.ts
  - packages/core/src/orgs/invite.ts
  - packages/core/test/orgs/invite.test.ts
  - packages/driver-sql/migrations/*-invitations.sql
  - .veebee/tickets/143-invite-someone-by-link.md
  - docs/auth.md
  - packages/contract/src/entities/invitations.ts
  - packages/contract/src/index.ts
  - packages/contract/src/operation.ts
  - packages/contract/src/operations/index.ts
  - packages/core/src/index.ts
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/statements.ts
  - packages/driver-sqlite/test/open.test.ts
  - packages/ports/src/index.ts
  - packages/ports/testkit/index.ts
  - packages/sdk/src/client.ts
  - packages/server/openapi.json
  - packages/server/src/app.ts
  - packages/server/src/auth/tokens.ts
  - packages/server/src/http/openapi.ts
  - packages/server/src/http/pipeline.ts
  - packages/server/src/http/scope.ts
  - packages/server/src/operations/index.ts
  - packages/server/test/auth/config-routes.test.ts
conformance: []
modes: [local]
depends_on: [134]
status: done
claimed_by: codex
issue: 144
---

## What the user does
As an organization admin, I make a link that lets a colleague join.

## Done when
- [x] as an `acme` admin, `POST http://127.0.0.1:8787/api/x/orgs/acme/invitations {"role":"member"}` answers an invitation and a `/invite/<token>` URL
- [x] `curl http://127.0.0.1:8787/api/x/invitations/<token>` with no credential answers the organization's name, the role and the expiry

## Out of scope
- Accepting (144); email sending (Q4); the invitation page (M8, 220).

## Notes
`docs/auth.md` "Invitations".
