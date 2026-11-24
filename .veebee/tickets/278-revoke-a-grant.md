---
id: 278
title: Revoke a grant
milestone: M10-access
package: server
writes:
  - packages/contract/src/operations/grants.ts
  - packages/core/src/access/grant-events.ts
  - packages/driver-sql/src/views/grants.ts
  - packages/driver-sql/src/statements.ts
  - packages/server/src/operations/grants.ts
  - packages/server/test/grants/revoke.test.ts
  - packages/cli/src/commands/grants.ts
  - packages/cli/test/grants.test.ts
  - docs/protocol.md
  - packages/cli/src/output.ts
  - packages/contract/src/index.ts
  - packages/contract/src/operations/audit.ts
  - packages/contract/src/operations/grants/list.ts
  - packages/contract/src/operations/grants/revoke.ts
  - packages/contract/src/operations/index.ts
  - packages/core/src/index.ts
  - packages/driver-sql/src/views/connections.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/ports/src/grants.ts
  - packages/ports/testkit/isolation.test-suite.ts
  - packages/server/openapi.json
  - packages/server/src/auth/personal-tokens.ts
  - packages/server/src/auth/sessions.ts
  - packages/server/src/auth/tokens.ts
  - packages/server/src/operations/audit.ts
  - packages/server/src/operations/grants/create.ts
  - packages/server/src/operations/grants/list.ts
  - packages/server/src/operations/grants/revoke.ts
  - packages/server/src/operations/index.ts
  - packages/server/test/isolation/seed.ts
  - skills/openboard/references/commands.md
  - tools/conformance/score.json
  - packages/contract/src/operation.ts
  - packages/driver-sql/src/views/orgs.ts
  - packages/ports/src/index.ts
  - packages/server/src/auth/access.ts
  - packages/server/src/http/openapi.ts
  - packages/server/test/grants/list.test.ts
conformance: ["grants/grants a principal, lists it, and revokes it"]
modes: [local, hosted]
depends_on: [277]
status: done
claimed_by: codex-t278
issue: 453
---

## What the user does
As a board owner, I take back a grant with `ob grants revoke g5`, effective from the next request.

## Done when
- [x] `ob grants revoke g5` prints `revoked g5`; the connection it named then gets `error: forbidden: …` posting to `deploys/web`, and `ob grants` no longer lists g5; revoking it again answers `{ "revoked": false }` (`--json`) and changes nothing
- [x] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `grants/grants a principal, lists it, and revokes it`, and `--update` records it in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- Revoking a grant that keeps its maker in (284).

## Notes
Upstream `POST /grants/:id/revoke` (no body, or `{ lockMeOut }`) → `{ revoked }`; `ob.grant.revoked`. A connection's own grant revoked this way leaves the connection with nothing; revoking the connection (127) still revokes its grant.
