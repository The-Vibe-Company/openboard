---
id: 156
title: Sign in from the terminal
milestone: M4-accounts-organizations-and-auth
package: cli
writes:
  - packages/contract/src/operations/accounts.ts
  - packages/server/src/operations/accounts.ts
  - packages/driver-sql/src/views/accounts.ts
  - packages/ports/testkit/store/accounts.test-suite.ts
  - packages/server/test/accounts.test.ts
  - packages/ports/src/store.ts
  - packages/cli/src/commands/login.ts
  - packages/cli/src/commands/index.ts
  - packages/cli/src/config.ts
  - packages/cli/test/login.test.ts
  - packages/driver-sql/migrations/*-device.sql
  - packages/server/test/device.test.ts
conformance: []
modes: [local]
depends_on: [118, 134, 142]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a person at a terminal, I sign the CLI in through my browser, without pasting a token.

## Done when
- [ ] `ob login http://127.0.0.1:8787` prints a code and `http://127.0.0.1:8787/device`, then waits
- [ ] approving with `curl -b cookies -H 'x-ob-csrf: …' -X POST http://127.0.0.1:8787/api/x/auth/device/approve -d '{"userCode":"…","org":"acme"}'` makes `ob login` print `acme` and its boards and store an `obp_` token in the keychain or a `0600` file

## Out of scope
- The `/device` page (M8, 221).
- Choosing a board (157).

## Notes
`docs/auth.md` "CLI sign-in (device flow)". Notes on mode: M4 must pass in local mode, but local mode has "no sign-up" (`docs/architecture.md` table) while sign-in providers can be configured (`docs/auth.md` "Local mode"). These criteria assume `ob serve` with `OPENBOARD_GITHUB_CLIENT_ID`, `OPENBOARD_GITHUB_CLIENT_SECRET` and `OPENBOARD_SIGNUP=open`; the owner must confirm (`.veebee/cut.md` "Could not place"). Until the front (M8), browser pages after sign-in are not built, so criteria use the documented `/api/x/…` routes with the session cookie and `x-ob-csrf`.
