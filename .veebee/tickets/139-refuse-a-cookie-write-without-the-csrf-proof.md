---
id: 139
title: Refuse a cookie write without the CSRF proof
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/server/src/auth/sessions.ts
  - packages/server/test/auth/csrf.test.ts
conformance: []
modes: [local]
depends_on: [134]
status: draft
claimed_by: null
issue: 140
---

## What the user does
As a person, a page on another site cannot act on the board with my session.

## Done when
- [ ] `curl -b cookies -X POST http://127.0.0.1:8787/api/x/orgs …` without `x-ob-csrf`, or with another `origin`, answers 403 `forbidden`; with a bearer token instead of the cookie no CSRF header is needed

## Out of scope
- Security headers of the front (M8, 217).

## Notes
`docs/auth.md` "Sessions and CSRF".
