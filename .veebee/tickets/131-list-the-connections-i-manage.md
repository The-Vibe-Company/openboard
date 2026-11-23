---
id: 131
title: List the connections I manage
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/contract/src/operations/connections.ts
  - packages/server/src/operations/connections.ts
  - packages/driver-sql/src/views/connections.ts
  - packages/ports/testkit/store/connections.test-suite.ts
  - packages/server/test/connections.test.ts
  - packages/ports/src/store.ts
conformance: []
modes: [local]
depends_on: [130]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an owner, I see every connection on my board with its agents, and never a secret.

## Done when
- [ ] `ob connections` lists each connection with its agents, last use and secret hint, and its output contains no `obc_` or `obt_` value

## Out of scope
- The settings page (M8, 234).

## Notes
`docs/protocol.md` board extensions (`GET /x/connections`, `/x/connections/:id`).
