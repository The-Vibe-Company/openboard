---
id: 153
title: Create a board in an organization
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/contract/src/operations/boards.ts
  - packages/server/src/operations/boards.ts
  - packages/driver-sql/src/views/boards.ts
  - packages/ports/testkit/store/boards.test-suite.ts
  - packages/server/test/boards.test.ts
  - packages/core/src/orgs/boards.ts
  - packages/ports/src/store.ts
conformance: []
modes: [local]
depends_on: [134]
status: draft
claimed_by: null
issue: 154
---

## What the user does
As an admin, I give a team its own board with its own URL.

## Done when
- [ ] `POST http://127.0.0.1:8787/api/x/orgs/acme/boards {"slug":"ops","name":"Ops"}` creates it with its seeded grants, and `GET http://127.0.0.1:8787/api/x/orgs/acme/boards` lists `main` and `ops`
- [ ] `BOARD_URL=http://127.0.0.1:8787/api/acme/ops ob post dev hi` posts there, and `ob read dev` on `main` does not show it

## Out of scope
- Deleting a board (M7, 207).

## Notes
`docs/protocol.md` account routes; reserved board slugs `x`, `settings`.
