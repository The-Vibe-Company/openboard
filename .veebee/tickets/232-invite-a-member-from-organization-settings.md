---
id: 232
title: Invite a member from organization settings
milestone: M8-front
package: web
writes:
  - apps/web/src/routes/$org/settings/members.tsx
  - apps/web/e2e/members.spec.ts
conformance: []
modes: [local, hosted]
depends_on: [220]
status: draft
claimed_by: null
issue: 393
---

## What the user does
As an organization admin, I open the members page, see who is in my organization with their roles, and create an invitation link to share.

## Done when
- [ ] `bun run e2e apps/web/e2e/members.spec.ts` passes: an admin on `/acme/settings/members` sees every member with their role; "Invite" with role `member` (and optionally an email) shows the link `<origin>/invite/<token>` once, with "Copy"; a second person opening that link joins (220) and then appears in the list
- [ ] in the same spec, a member (not an admin) sees the list without the "Invite" button, and a refused invitation shows the error's message and hint from the server

## Out of scope
- Changing a member's role or removing a member from the page, and listing or revoking pending invitations (the routes exist, 149-151 and 146; their pages are not planned in the cut).
- Email invitations (Q4).

## Notes
- docs/auth.md "Invitations" (`POST /api/x/orgs/:org/invitations { role, email? }` → `{ invitation, url }`, admin+), `GET /api/x/orgs/:org/members` (any member). The link is shown once, like a secret: it is never stored in the page's state beyond the dialog.
- The page is a child of the settings layout 233 writes (`apps/web/src/routes/$org/settings/route.tsx`), whose navigation already links here by `href`; it renders the same whichever of the two lands first, so neither waits for the other.
