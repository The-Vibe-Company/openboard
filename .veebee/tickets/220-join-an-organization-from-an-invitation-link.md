---
id: 220
title: Join an organization from an invitation link
milestone: M8-front
package: web
writes:
  - apps/web/src/routes/invite.$token.tsx
  - apps/web/e2e/invite.spec.ts
conformance: []
modes: [local, hosted]
depends_on: [195, 218]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an invited person, I open the link I was sent, see which organization invites me and with what role, and join it in one click, signing up on the way if I am new.

## Done when
- [ ] `bun run e2e apps/web/e2e/invite.spec.ts` passes: an admin creates an invitation; a new person opening its `/invite/<token>` sees the organization's name, the role and the expiry, chooses "Sign in with GitHub to join", and lands on `/<org>/main` as a member with that role, on a server the spec starts with sign-up `invite`
- [ ] in the same spec, a person already signed in sees "Join <organization>", and joining calls `POST /api/x/invitations/accept` and lands on `/<org>/main`; a used, revoked or expired link shows "This invitation is no longer valid", and a person who already belongs to an organization sees why they cannot join (409 `already_in_org`)

## Out of scope
- Creating and sharing invitations (232).
- Email invitations (Q4).

## Notes
- docs/auth.md "Sign-up and sign-in" and "Invitations" (`GET /api/x/invitations/:token` needs no credential and returns `{ orgName, role, expiresAt }`; 404 unknown, 410 `invitation_used`), 144-148. A person not signed in leaves through `/auth/github/start?invitation=<token>`, where the server keeps the token in the pending sign-in and accepts it in the sign-in's transaction (195), so the link works on an invite-only server.
- The token is in the path of this page: the request log already redacts `/invite/…` (`packages/server/src/http/pipeline.ts`), and the page never sends it to a third party (`referrer-policy: same-origin`, 217).
