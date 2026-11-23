---
id: 127
title: Refuse a non-direct secret as a bearer
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/server/src/auth/connections.ts
  - packages/server/test/auth/non-direct.test.ts
conformance: []
modes: [local]
depends_on: [117]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an owner, a claim-only secret cannot be used to write directly.

## Done when
- [ ] `BOARD_TOKEN="$(cat fixers.secret)" ob read dev` prints `error: unauthorized` for a connection created without `--direct`

## Out of scope
- Claims with it (117).

## Notes
Verifier chain step 2 (`docs/auth.md`).
