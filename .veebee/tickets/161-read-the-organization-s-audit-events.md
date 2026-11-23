---
id: 161
title: Read the organization's audit events
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/contract/src/operations/audit.ts
  - packages/server/src/operations/audit.ts
  - packages/driver-sql/src/views/audit.ts
  - packages/server/test/audit.test.ts
conformance: []
modes: [local]
depends_on: [132, 143, 149]
status: draft
claimed_by: null
issue: 162
---

## What the user does
As an admin, I see who joined, who invited whom and who changed roles.

## Done when
- [ ] `GET http://127.0.0.1:8787/api/x/orgs/acme/audit` as an admin lists `ob.org.created`, `ob.invitation.created`, `ob.member.added` and `ob.member.role_changed` with their actors; as a member it answers 403

## Out of scope
- Operator access records (M7, 214).

## Notes
`org_events` (`docs/data-model.md`); `docs/auth.md` "Audit".
