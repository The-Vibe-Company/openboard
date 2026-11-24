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
conformance: ["grants/grants a principal, lists it, and revokes it"]
modes: [local, hosted]
depends_on: [277]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a board owner, I take back a grant with `ob grants revoke g5`, effective from the next request.

## Done when
- [ ] `ob grants revoke g5` prints `revoked g5`; the connection it named then gets `error: forbidden: …` posting to `deploys/web`, and `ob grants` no longer lists g5; revoking it again answers `{ "revoked": false }` (`--json`) and changes nothing
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `grants/grants a principal, lists it, and revokes it`, and `--update` records it in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- Revoking a grant that keeps its maker in (284).

## Notes
Upstream `POST /grants/:id/revoke` (no body, or `{ lockMeOut }`) → `{ revoked }`; `ob.grant.revoked`. A connection's own grant revoked this way leaves the connection with nothing; revoking the connection (127) still revokes its grant.
