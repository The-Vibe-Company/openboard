---
id: 233
title: Create a board from organization settings
milestone: M8-front
package: web
writes:
  - apps/web/src/routes/$org/settings/route.tsx
  - apps/web/src/routes/$org/settings/index.tsx
  - apps/web/src/routes/$org/settings/boards.tsx
  - apps/web/e2e/boards.spec.ts
conformance: []
modes: [local, hosted]
depends_on: [216]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an organization admin, I open my organization's settings, see its boards, and create a new one that I can open at once.

## Done when
- [ ] `bun run e2e apps/web/e2e/boards.spec.ts` passes: an admin on `/acme/settings` sees the organization's name and a "Boards" section; on `/acme/settings/boards`, creating "Ops" with slug `ops` adds it to the list with its `BOARD_URL`, and opening it goes to `/acme/ops`
- [ ] in the same spec, a taken slug shows "ops is taken" (409 `slug_taken`), the 11th board shows the quota's message (196), and a member who is not an admin sees the list without the create form

## Out of scope
- Deleting a board from the page (the route exists, 209; its page is not planned in the cut).
- Members (232).

## Notes
- docs/architecture.md "Front routes" (`/:org/settings`, `/:org/settings/boards`), docs/protocol.md route inventory (`GET, POST /api/x/orgs/:org/boards`, member / admin), 153. The settings layout (`apps/web/src/routes/$org/settings/route.tsx`) starts here, with a navigation to General, Members and Boards; it links by `href`, not typed routes, so the members page (232) can land before or after it without touching this file.
