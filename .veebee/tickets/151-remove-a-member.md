---
id: 151
title: Remove a member
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/contract/src/operations/memberships.ts
  - packages/server/src/operations/memberships.ts
  - packages/driver-sql/src/views/memberships.ts
  - packages/ports/testkit/store/memberships.test-suite.ts
  - packages/server/test/memberships.test.ts
  - packages/ports/src/store.ts
conformance: []
modes: [local]
depends_on: [150]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an admin, I remove someone; as a member, I leave.

## Done when
- [ ] `POST http://127.0.0.1:8787/api/x/orgs/acme/members/<user>/remove` by an admin, or by the person themself, ends their access: their next request to `/api/acme/main` answers 404

## Out of scope
- Their sessions elsewhere, which stay valid (`docs/auth.md`).

## Notes
Membership checks are cached 60 s and invalidated on change.
