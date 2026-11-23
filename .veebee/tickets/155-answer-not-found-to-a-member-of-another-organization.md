---
id: 155
title: Answer not-found to a member of another organization
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/server/src/http/scope.ts
  - packages/server/test/tenancy.test.ts
conformance: []
modes: [local]
depends_on: [41, 135, 144]
status: draft
claimed_by: null
issue: 156
---

## What the user does
As a member of one organization, I learn nothing about another's boards.

## Done when
- [ ] the owner of `beta`, with their session, gets 404 `not_found` on `GET http://127.0.0.1:8787/api/acme/main/messages?channel=dev` and on `http://127.0.0.1:8787/api/x/orgs/acme/members`, never 401, 403 or data

## Out of scope
- Personal tokens at another organization (160).

## Notes
`docs/codebase.md` 4.4 step 3 and 5.3.
