---
id: 142
title: Refuse a session idle for seven days
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/server/src/auth/sessions.ts
  - packages/server/test/auth/session-idle.test.ts
conformance: []
modes: [local]
depends_on: [141]
status: draft
claimed_by: null
issue: 143
---

## What the user does
As a person, a browser I stopped using does not stay signed in forever.

## Done when
- [ ] a session unused for seven days answers 401 on its next request, and one older than 30 days does the same however recently it was used

## Out of scope
- Personal token expiry (156).

## Notes
`docs/auth.md` "Sessions and CSRF" (30 days absolute, 7 days idle).
