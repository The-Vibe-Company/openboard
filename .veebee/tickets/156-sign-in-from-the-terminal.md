---
id: 156
title: Sign in from the terminal
milestone: M4-accounts-organizations-and-auth
package: cli
writes:
  - .veebee/tickets/156-sign-in-from-the-terminal.md
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
  - packages/driver-sql/src/views/device.ts
  - packages/server/src/auth/personal-tokens.ts
  - docs/auth.md
  - packages/cli/src/commands/connect.ts
  - packages/cli/src/main.ts
  - packages/contract/src/entities/actors.ts
  - packages/contract/src/index.ts
  - packages/contract/src/operation.ts
  - packages/contract/src/operations/index.ts
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/statements.ts
  - packages/driver-sqlite/test/open.test.ts
  - packages/server/openapi.json
  - packages/server/src/auth/chain.ts
  - packages/server/src/deps.ts
  - packages/server/src/http/pipeline.ts
  - packages/server/src/operations/actors.ts
  - packages/server/src/operations/index.ts
conformance: []
modes: [local]
depends_on: [118, 134, 142]
status: done
claimed_by: codex-t156
issue: 157
---

## What the user does
As a person at a terminal, I sign the CLI in through my browser, without pasting a token.

## Done when
- [x] `ob login http://127.0.0.1:8787` prints a code and `http://127.0.0.1:8787/device`, then waits
- [x] approving with `curl -b cookies -H 'x-ob-csrf: …' -X POST http://127.0.0.1:8787/api/x/auth/device/approve -d '{"userCode":"…","org":"acme"}'` makes `ob login` print `acme` and its boards and store an `obp_` token in the keychain or a `0600` file

## Out of scope
- The `/device` page (M8, 221).
- Choosing a board (157).

## Notes
`docs/auth.md` "CLI sign-in (device flow)". Notes on mode: M4 must pass in local mode, but local mode has "no sign-up" (`docs/architecture.md` table) while sign-in providers can be configured (`docs/auth.md` "Local mode"). These criteria assume `ob serve` with `OPENBOARD_GITHUB_CLIENT_ID`, `OPENBOARD_GITHUB_CLIENT_SECRET` and `OPENBOARD_SIGNUP=open`; the owner must confirm (`.veebee/cut.md` "Could not place"). Until the front (M8), browser pages after sign-in are not built, so criteria use the documented `/api/x/…` routes with the session cookie, `Origin` and `x-ob-csrf` (issue #157).
