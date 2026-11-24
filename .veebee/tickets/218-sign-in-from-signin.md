---
id: 218
title: Sign in from /signin
milestone: M8-front
package: web
writes:
  - apps/web/src/routes/signin.tsx
  - apps/web/src/api/session.ts
  - apps/web/src/routes/__root.tsx
  - apps/web/src/components/Header.tsx
  - apps/web/e2e/signin.spec.ts
  - apps/web/e2e/support/serve.ts
  - apps/web/e2e/support/sign-in.ts
  - apps/web/src/routeTree.gen.ts
  - apps/web/src/styles.css
  - docs/auth.md
conformance: []
modes: [local, hosted]
depends_on: [216]
status: done
claimed_by: codex
issue: 379
---

## What the user does
As a person, I open `/signin`, choose GitHub, and come back signed in with my name in the page's header and a way to sign out.

## Done when
- [ ] `bun run e2e apps/web/e2e/signin.spec.ts` passes: `/signin` shows one button per provider `GET /api/x/session` lists; choosing GitHub returns signed in, and the header shows the person's handle and avatar on every page; "Sign out" posts `/auth/logout`, after which the header offers "Sign in" and `GET /api/x/session` reports no person
- [ ] in the same spec, a signed-in person opening `/signin` is sent to `/`, and a server with no provider configured shows "No sign-in is configured on this server" instead of buttons

## Out of scope
- Creating an organization after signing up (219); joining from an invitation (220).
- Refused sign-ups (195, 205) are shown as the server's error page for now; a page for them is not planned.

## Notes
- docs/auth.md "Sign-up and sign-in" and "Sessions and CSRF"; D48 (`/auth/<provider>/start|callback`, `POST /auth/logout`). Where the callback lands (`/<org>/main` or `/new`) is the server's choice (195); this page only starts the redirect.
- `apps/web/src/api/session.ts` holds the session query (person, CSRF value, providers) every page reads; `apps/web/src/api/client.ts` (216) already sends the CSRF value.
- The spec signs in through `apps/web/e2e/support/sign-in.ts` (216).
