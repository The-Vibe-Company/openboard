---
id: 144
title: Accept an invitation
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/contract/src/operations/invitations.ts
  - packages/server/src/operations/invitations.ts
  - packages/driver-sql/src/views/invitations.ts
  - packages/ports/testkit/store/invitations.test-suite.ts
  - packages/server/test/invitations.test.ts
  - packages/ports/src/store.ts
conformance: []
modes: [local]
depends_on: [143]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an invited person, I join the organization with the role I was given.

## Done when
- [ ] a second person, signed in with GitHub, `POST http://127.0.0.1:8787/api/x/invitations/accept {"token":…}` becomes a `member` of `acme`, and `GET http://127.0.0.1:8787/api/x/orgs/acme/members` lists both people

## Out of scope
- Used, revoked or expired links (147).
- Membership caps on boards (152).

## Notes
One transaction with `ob.member.added` (`docs/auth.md`). Notes on mode: M4 must pass in local mode, but local mode has "no sign-up" (`docs/architecture.md` table) while sign-in providers can be configured (`docs/auth.md` "Local mode"). These criteria assume `ob serve` with `OPENBOARD_GITHUB_CLIENT_ID`, `OPENBOARD_GITHUB_CLIENT_SECRET` and `OPENBOARD_SIGNUP=open`; the owner must confirm (`.veebee/cut.md` "Could not place"). Until the front (M8), browser pages after sign-in are not built, so criteria use the documented `/api/x/…` routes with the session cookie and `x-ob-csrf`.
