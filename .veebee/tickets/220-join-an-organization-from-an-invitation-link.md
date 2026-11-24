---
id: 220
title: Join an organization from an invitation link
milestone: M8-front
package: web
writes:
  - apps/web/src/routes/invite.$token.tsx
  - apps/web/e2e/invite.spec.ts
  - apps/web/e2e/support/serve.ts
  - apps/web/e2e/support/sign-in.ts
  - docs/auth.md
  - apps/web/src/styles.css
  - packages/driver-sql/src/views/accounts.ts
  - packages/ports/src/account-records.ts
  - packages/ports/src/index.ts
  - packages/ports/src/store.ts
  - packages/server/src/auth/providers/index.ts
  - packages/server/src/auth/providers/invitation.ts
  - packages/server/test/auth/signup.test.ts
  - packages/server/test/support/sign-in.ts
  - docs/decisions.md
conformance: []
modes: [local, hosted]
depends_on: [195, 218]
status: done
claimed_by: codex
issue: 381
---

## What the user does
As an invited person, I open the link I was sent, see which organization invites me and with what role, and join it in one click, signing up on the way if I am new.

## Done when
- [x] `bun run e2e apps/web/e2e/invite.spec.ts` passes: an admin creates an invitation; a new person opening its `/invite/<token>` sees the organization's name, the role and the expiry, chooses "Sign in with GitHub to join", and lands on `/<org>/main` as a member with that role, on a server the spec starts with sign-up `invite`
- [x] in the same spec, a person already signed in sees "Join <organization>", and joining calls `POST /api/x/invitations/accept` and lands on `/<org>/main`; a used, revoked or expired link shows "This invitation is no longer valid", and a person who already belongs to an organization sees why they cannot join (409 `already_in_org`)

- [x] the same spec verifies that GitHub sign-in from an invitation redeems it for returning people and new people on open sign-up, and that a failed redemption returns the signed-in person to the invitation with the reason (owner decision on #381).

## Out of scope
- Creating and sharing invitations (232).
- Email invitations (Q4).

## Notes
- docs/auth.md "Sign-up and sign-in" and "Invitations" (`GET /api/x/invitations/:token` needs no credential and returns `{ orgName, role, expiresAt }`; 404 unknown, 410 `invitation_used`), 144-148. A person not signed in leaves through `/auth/github/start?invitation=<token>`, where the server keeps the token in the pending sign-in and accepts it in the sign-in's transaction (195), so the link works on an invite-only server.
- The token is in the path of this page: the request log already redacts `/invite/…` (`packages/server/src/http/pipeline.ts`), and the page never sends it to a third party (`referrer-policy: same-origin`, 217).
