---
id: 134
title: Create an organization
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/contract/src/operations/orgs.ts
  - packages/server/src/operations/orgs.ts
  - packages/driver-sql/src/views/orgs.ts
  - packages/ports/testkit/store/orgs.test-suite.ts
  - packages/server/test/orgs.test.ts
  - packages/ports/src/store.ts
  - packages/contract/src/entities/orgs.ts
  - packages/core/src/orgs/create.ts
  - packages/core/test/orgs/create.test.ts
  - packages/driver-sql/migrations/*-orgs.sql
  - packages/contract/src/operations/accounts.ts
  - packages/contract/src/operations/index.ts
  - packages/contract/src/index.ts
  - packages/contract/src/entities/actors.ts
  - packages/core/src/index.ts
  - packages/ports/testkit/index.ts
  - packages/ports/src/index.ts
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/statements.ts
  - packages/driver-sql/src/views/accounts.ts
  - packages/driver-sqlite/test/open.test.ts
  - packages/server/src/operations/accounts.ts
  - packages/server/src/operations/index.ts
  - packages/server/src/operations/actors.ts
  - packages/server/src/auth/chain.ts
  - packages/server/src/auth/sessions.ts
  - packages/server/src/deps.ts
  - packages/server/src/http/pipeline.ts
conformance: []
modes: [local]
depends_on: [133]
status: claimed
claimed_by: claude-opus-5-5
issue: 135
---

## What the user does
As a person who just signed in, I create my organization and get its board `main`.

## Done when
- [ ] `curl -b cookies -H 'x-ob-csrf: <csrf>' -H 'origin: <public URL>' -X POST http://127.0.0.1:8787/api/x/orgs -d '{"name":"Acme","slug":"acme"}'` answers the organization, an `owner` membership and board `main`
- [ ] `curl -b cookies http://127.0.0.1:8787/api/x/me` lists `acme (owner)`, and `curl -b cookies http://127.0.0.1:8787/api/acme/main/me` answers role `owner`

## Out of scope
- Slug rules (136, 137), the one-organization rule (138), the `/new` page (M8, 219).

## Notes
`docs/auth.md` "Sign-up and sign-in" (one transaction). Notes on mode: M4 must pass in local mode, but local mode has "no sign-up" (`docs/architecture.md` table) while sign-in providers can be configured (`docs/auth.md` "Local mode"). These criteria assume `ob serve` with `OPENBOARD_GITHUB_CLIENT_ID`, `OPENBOARD_GITHUB_CLIENT_SECRET` and `OPENBOARD_SIGNUP=open`; the owner must confirm (`.veebee/cut.md` "Could not place"). Until the front (M8), browser pages after sign-in are not built, so criteria use the documented `/api/x/…` routes with the session cookie and `x-ob-csrf`.
