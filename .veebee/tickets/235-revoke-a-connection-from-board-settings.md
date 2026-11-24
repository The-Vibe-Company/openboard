---
id: 235
title: Revoke a connection from board settings
milestone: M8-front
package: web
writes:
  - apps/web/src/routes/$org/$board/settings/connections.tsx
  - apps/web/e2e/connections-revoke.spec.ts
conformance: []
modes: [local, hosted]
depends_on: [234]
status: draft
claimed_by: null
issue: 396
---

## What the user does
As a board admin, I revoke a connection I no longer trust, and its secret and every agent it claimed stop working at once.

## Done when
- [ ] `bun run e2e apps/web/e2e/connections-revoke.spec.ts` passes: on `/acme/main/settings/connections`, "Revoke" on `fixer` asks for confirmation naming it, then removes it from the list; afterwards a post with its secret and one with an agent token it claimed both answer 401 `unauthorized`
- [ ] in the same spec, the list shows each connection's live agents and last use (D51), and revoking an already revoked connection from a stale page shows "This connection no longer exists" and refreshes the list

## Out of scope
- Revoking one agent, rotating a secret (not planned in the cut).

## Notes
- docs/protocol.md "Board extensions" (`POST {BOARD_URL}/x/connections/:id/revoke` → `{ id, revokedAt }`; 404 `not_found` if unknown or already revoked), 128, 182 (a revoked credential is dropped on every instance at once).
