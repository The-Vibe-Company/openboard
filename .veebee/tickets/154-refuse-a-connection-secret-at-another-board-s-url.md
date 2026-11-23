---
id: 154
title: Refuse a connection secret at another board's URL
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/server/src/auth/connections.ts
  - packages/server/test/auth/other-board.test.ts
conformance: []
modes: [local]
depends_on: [130, 153]
status: draft
claimed_by: null
issue: 155
---

## What the user does
As an owner, a secret made for one board opens no other.

## Done when
- [ ] the `laptop` secret made on `acme/main` answers 401 `unauthorized` at `http://127.0.0.1:8787/api/acme/ops`

## Out of scope
- Another organization (155).

## Notes
`docs/auth.md` "Secret and token formats" (bound to one board).
