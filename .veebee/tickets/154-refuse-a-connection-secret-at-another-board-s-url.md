---
id: 154
title: Refuse a connection secret at another board's URL
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - docs/codebase.md
  - packages/server/src/auth/connections.ts
  - packages/server/src/operations/connections.ts
  - packages/server/test/auth/other-board.test.ts
conformance: []
modes: [local]
depends_on: [130, 153]
status: done
claimed_by: codex-t154
issue: 155
---

## What the user does
As an owner, a secret made for one board opens no other.

## Done when
- [x] the `laptop` secret made on `acme/main` answers 401 `unauthorized` for `GET /api/acme/ops/me` and `POST /api/acme/ops/messages` at `http://127.0.0.1:8787`; the post writes nothing

## Out of scope
- Another organization (155).

## Notes
`docs/auth.md` "Secret and token formats" (bound to one board).
