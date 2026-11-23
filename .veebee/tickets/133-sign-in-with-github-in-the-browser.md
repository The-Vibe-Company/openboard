---
id: 133
title: Sign in with GitHub in the browser
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/contract/src/operations/accounts.ts
  - packages/server/src/operations/accounts.ts
  - packages/driver-sql/src/views/accounts.ts
  - packages/ports/testkit/store/accounts.test-suite.ts
  - packages/server/test/accounts.test.ts
  - packages/ports/src/store.ts
  - packages/contract/src/entities/accounts.ts
  - packages/server/src/auth/providers/github/**
  - packages/server/src/auth/providers/index.ts
  - packages/server/src/auth/sessions.ts
  - packages/server/src/auth/chain.ts
  - apps/openboard/src/config.ts
  - packages/driver-sql/migrations/*-accounts.sql
  - packages/contract/src/operations/index.ts
  - packages/contract/src/index.ts
  - packages/ports/src/index.ts
  - packages/ports/testkit/index.ts
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/statements.ts
  - packages/driver-sql/src/views/boards.ts
  - packages/driver-sqlite/test/open.test.ts
  - packages/server/src/app.ts
  - packages/server/src/deps.ts
  - packages/server/src/http/pipeline.ts
  - packages/server/src/operations/index.ts
  - packages/server/src/auth/secrets.ts
  - apps/openboard/src/compose.ts
  - apps/openboard/test/config.test.ts
  - docs/decisions.md
  - docs/codebase.md
conformance: []
modes: [local]
depends_on: [62, 117]
status: claimed
claimed_by: claude-opus-t133
issue: 134
---

## What the user does
As a person, I sign in to the board with my GitHub account.

## Done when
- [ ] opening `http://127.0.0.1:8787/auth/github/start` signs in on GitHub and comes back with a `__Host-ob_session` cookie
- [ ] `curl -b cookies http://127.0.0.1:8787/api/x/session` answers signed in, with my GitHub login, my providers and a CSRF value

## Out of scope
- Creating an organization (134); sign-in pages (M8, 218); Google and email links (seams, not built).

## Notes
`docs/auth.md` "Sign-up and sign-in", "Sign-in providers". Notes on mode: M4 must pass in local mode, but local mode has "no sign-up" (`docs/architecture.md` table) while sign-in providers can be configured (`docs/auth.md` "Local mode"). These criteria assume `ob serve` with `OPENBOARD_GITHUB_CLIENT_ID`, `OPENBOARD_GITHUB_CLIENT_SECRET` and `OPENBOARD_SIGNUP=open`; the owner must confirm (`.veebee/cut.md` "Could not place"). Until the front (M8), browser pages after sign-in are not built, so criteria use the documented `/api/x/…` routes with the session cookie and `x-ob-csrf`.
