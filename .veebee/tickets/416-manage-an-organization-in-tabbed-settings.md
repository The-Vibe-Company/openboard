---
id: 416
title: Manage an organization in tabbed settings with tables
milestone: M16-front-design
package: web
writes:
  - apps/web/src/routes/$org/index.tsx
  - apps/web/src/routes/$org/settings/route.tsx
  - apps/web/src/routes/$org/settings/index.tsx
  - apps/web/src/routes/$org/settings/members.tsx
  - apps/web/src/routes/$org/settings/boards.tsx
  - apps/web/src/routes/$org/settings/members.css
  - apps/web/src/routes/$org/settings/settings.css
  - apps/web/src/routes/$org/org.css
conformance: []
modes: [local, hosted]
depends_on: [411]
status: draft
issue: 794
---

## What the user does
As an owner, organization settings look like Vercel's team settings: a title, a left column of tabs (General, Members, Boards), and each section in a `Card` with its table and form.

## Done when
- [ ] Organization settings show the tabs with the current one highlighted; Members and Boards are `Table`s with muted column headers, and the invite and create-board forms are `Field`s with a primary button in the card footer
- [ ] The organization page `/<org>` lists its boards as cards linking to each board; at 375 px the tabs become a horizontal row and nothing overflows

## Rules
- Use only the tokens and primitives of `docs/design.md` (ticket 411): no colour, radius, shadow or font size written as a raw value outside `apps/web/src/styles.css`.
- Styles live in a CSS file next to the page or component, scoped under one class on its root element; never append to `apps/web/src/styles.css` (except ticket 411).
- No new npm dependency (no Tailwind, no component kit): plain React and CSS.
- Keep every accessible name, role and label the Playwright specs in `apps/web/e2e/` use, so `web.yml` stays green without editing those specs.
- Check the pages you touch in a real browser (Playwright or the dev server) at 1280 px and 375 px wide, in light and dark (`prefers-color-scheme`), and say in the PR what you checked.

## Out of scope
Board settings (417). The top bar (412).
