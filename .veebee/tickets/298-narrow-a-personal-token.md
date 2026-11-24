---
id: 298
title: Narrow a personal token
milestone: M10-access
package: server
writes:
  - packages/contract/src/operations/accounts.ts
  - packages/contract/src/entities/accounts.ts
  - packages/server/src/operations/accounts.ts
  - packages/server/src/auth/personal-tokens.ts
  - packages/driver-sql/src/views/device.ts
  - packages/driver-sql/src/views/accounts.ts
  - packages/driver-sql/src/statements.ts
  - packages/cli/src/commands/login.ts
  - packages/cli/test/login.test.ts
  - packages/server/test/auth/personal-token-can.test.ts
  - apps/web/e2e/device.spec.ts
  - apps/web/src/routes/device.tsx
  - docs/auth.md
  - docs/data-model.md
  - docs/decisions.md
  - docs/protocol.md
  - packages/cli/src/commands/usage.ts
  - packages/contract/src/can-scope.ts
  - packages/contract/src/index.ts
  - packages/contract/src/operation.ts
  - packages/core/src/access/narrow.ts
  - packages/driver-sql/migrations/0033-device-can.sql
  - packages/driver-sql/src/index.ts
  - packages/ports/src/account-records.ts
  - packages/ports/src/store.ts
  - packages/sdk/src/client.ts
  - packages/sdk/test/client.test.ts
  - packages/server/openapi.json
  - packages/server/src/http/openapi.ts
  - packages/server/src/http/pipeline.ts
  - packages/server/src/operations/index.ts
  - packages/server/test/auth/personal-token.test.ts
  - skills/openboard/references/commands.md
  - packages/server/src/auth/access.ts
  - packages/server/src/operations/grants/authority.ts
  - packages/server/src/operations/grants/list.ts
conformance: []
modes: [local, hosted]
depends_on: [286, 221]
status: done
claimed_by: Codex
issue: 473
---

## What the user does
As a person, I sign a terminal in with less than I may do, `ob login <origin> --can 'dev=read'`, so a script using that token can only read `dev`.

## Done when
- [x] on a local server with `OPENBOARD_SIGNUP=open` and GitHub configured, `ob login http://127.0.0.1:8787 --can 'dev=read'` approved on `/device` gives a token for which `ob whoami` shows `can` `{ dev: ["read"] }`; `ob read dev` works and `ob post dev hi` prints `error: forbidden: …`; a `can` wider than the person's own access never widens it
- [x] `ob tokens` lists the token with its `can`, and `ob login … --can 'dev'` prints `error: invalid_scope: …` before any request

## Out of scope
- Narrowing a session in the browser: not planned.

## Notes
Personal tokens (docs/auth.md "Secret and token formats": one person, one organization, optionally one board); migration 0033 adds the nullable `device_codes.can` column. The scope is shown on /device and capped per board at approval. Run `ob tokens` with an unrestricted personal token. The pin applies as an `x-board-can` would (286), intersected with any header. Depends on 221, the last ticket before it to change the device flow's files.
