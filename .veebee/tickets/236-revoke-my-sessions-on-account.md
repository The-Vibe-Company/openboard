---
id: 236
title: Revoke my sessions on /account
milestone: M8-front
package: web
writes:
  - apps/web/src/routes/account.tsx
  - apps/web/e2e/account.spec.ts
  - apps/web/src/api/client.ts
  - apps/web/src/components/Header.tsx
  - apps/web/src/routes/account.css
  - docs/auth.md
conformance: []
modes: [local, hosted]
depends_on: [218]
status: done
claimed_by: codex
issue: 397
---

## What the user does
As a signed-in person, I open `/account` to see who I am signed in as and my terminal tokens, sign out everywhere, or revoke a token I no longer use.

## Done when
- [ ] `bun run e2e apps/web/e2e/account.spec.ts` passes: with the same person signed in in two browser contexts, "Sign out everywhere" on `/account` in the first sends both to `/signin` on their next request, and `GET /api/x/session` reports no person in either
- [ ] in the same spec, `/account` lists the person's personal tokens (name, organization, expiry) from a device sign-in; "Revoke" on one marks it revoked, and a board request with that `obp_` token then answers 401 `unauthorized`

## Out of scope
- Linking and unlinking sign-in identities (the routes are listed in docs/protocol.md but not built; not planned in the cut).
- Deleting the person's account (not planned).

## Notes
- docs/auth.md "Sessions and CSRF" ("sign out everywhere" revokes all of a person's sessions) and "CLI sign-in" (personal tokens revocable from `/account` once the page ships); routes `POST /api/x/me/sessions/revoke-all` (141), `GET /api/x/tokens` and `POST /api/x/tokens/:id/revoke` (159), all with the session cookie, `Origin` and `x-ob-csrf`.
