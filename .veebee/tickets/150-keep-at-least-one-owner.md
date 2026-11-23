---
id: 150
title: Keep at least one owner
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - .veebee/tickets/150-keep-at-least-one-owner.md
  - docs/decisions.md
  - docs/protocol.md
  - packages/contract/src/errors.ts
  - packages/core/src/index.ts
  - packages/server/openapi.json
  - packages/contract/src/operations/memberships.ts
  - packages/server/src/operations/memberships.ts
  - packages/driver-sql/src/views/memberships.ts
  - packages/ports/testkit/store/memberships.test-suite.ts
  - packages/server/test/memberships.test.ts
  - packages/ports/src/store.ts
  - packages/core/src/orgs/roles.ts
  - packages/core/test/orgs/roles.test.ts
conformance: []
modes: [local]
depends_on: [149]
status: done
claimed_by: Codex
issue: 151
---

## What the user does
As an organization, I can never be left without an owner.

## Done when
- [x] Demoting the only owner returns 409 `last_owner`, and the organization still lists them as `owner`.
- [x] The guard and error contract are available to member removal. Ticket 151
  (issue #152) adds the removal route and verifies that removing the only owner
  returns 409 `last_owner` and leaves them on the roster.

## Out of scope
- Transferring ownership: promote another owner first.

## Notes
The decision on issue #151 specifies 409 `last_owner` for the refusal.
