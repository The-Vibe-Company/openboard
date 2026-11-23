---
id: 109
title: Create a connection on the board
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/contract/src/operations/connections.ts
  - packages/server/src/operations/connections.ts
  - packages/driver-sql/src/views/connections.ts
  - packages/ports/testkit/store/connections.test-suite.ts
  - packages/server/test/connections.test.ts
  - packages/ports/src/store.ts
  - packages/contract/src/entities/connections.ts
  - packages/contract/src/errors.ts
  - packages/core/src/access/grants.ts
  - packages/core/test/access/grants.test.ts
  - packages/driver-sql/migrations/*-connections.sql
conformance: []
modes: [local]
depends_on: [38, 43]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a board owner, I create a connection an agent will use, with what it may do on the board.

## Done when
- [ ] `ob connections create laptop --direct --can '*=all' --secret-file ./laptop.secret` writes an `obc_…` secret to `./laptop.secret` with mode `0600`, prints the connection's ID and `BOARD_URL`, and never prints the secret

## Out of scope
- Using the secret (110); claims (117); revoke, rotate, list (128, 130, 131).
- Full grants and `explain` (M10).

## Notes
`docs/auth.md` "Connections" (the connection's grant is an ordinary grant whose principal kind is `connection`; only that grant is compiled here). Land the OpenBoard error codes of `docs/protocol.md` "Error envelope" in `errors.ts` in this ticket, so the M4 tickets that use them do not compete for the file.
