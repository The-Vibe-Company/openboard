---
id: 152
title: Cap a member's board permissions by role
milestone: M4-accounts-organizations-and-auth
package: core
writes:
  - packages/core/src/access/grants.ts
  - packages/core/test/access/grants.test.ts
  - packages/server/test/auth/member-cap.test.ts
  - packages/server/src/operations/actors.ts
  - packages/server/src/operations/connections.ts
conformance: []
modes: [local]
depends_on: [109, 144]
status: done
claimed_by: claude-opus-5-5
issue: 153
---

## What the user does
As an admin, members can read, post, react and label, but not manage the board, unless a grant says more.

## Done when
- [x] a member's `GET http://127.0.0.1:8787/api/acme/main/me` shows `can * read post react label`, and creating a connection there answers 403 `forbidden`
- [x] an admin's shows `manage`

## Out of scope
- Grants that give more (M10, 276).

## Notes
Seeded grant `g1` capped by role (`docs/auth.md`).
