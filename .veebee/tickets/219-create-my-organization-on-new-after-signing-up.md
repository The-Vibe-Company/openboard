---
id: 219
title: Create my organization on /new after signing up
milestone: M8-front
package: web
writes:
  - apps/web/src/routes/new.tsx
  - apps/web/e2e/new-org.spec.ts
conformance: []
modes: [local, hosted]
depends_on: [218]
status: draft
claimed_by: null
issue: 380
---

## What the user does
As a person who just signed up, I name my organization on `/new`, and I land on its board `main`.

## Done when
- [ ] `bun run e2e apps/web/e2e/new-org.spec.ts` passes: a new person signs in, lands on `/new`, types "Acme Labs", sees the slug `acme-labs` proposed and editable, submits, and lands on `/acme-labs/main`; `GET /api/x/me` then lists an `owner` membership of `acme-labs`
- [ ] in the same spec, a taken slug shows "acme-labs is taken" and a reserved one (`settings`) shows "settings is reserved" under the field without leaving the page, and a person who already belongs to an organization opening `/new` is sent to that organization's board `main`

## Out of scope
- The board page itself (222); invitations (220).
- Several organizations per person (docs/architecture.md "Non-goals").

## Notes
- docs/auth.md "Sign-up and sign-in" (`POST /api/x/orgs { name, slug }`, one transaction: organization, owner membership, board `main`), docs/protocol.md "URLs" (slug rules, reserved slugs). The errors are the server's: 409 `slug_taken`, 400 `reserved_slug`, 409 `already_in_org` (134, 136-138); the page maps their codes to field messages and never repeats the rules client-side beyond the slug's shape.
- Navigate to the new board by `href`, so this page does not need the board route (222) to exist yet.
