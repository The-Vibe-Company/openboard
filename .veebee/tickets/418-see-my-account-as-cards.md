---
id: 418
title: See my account's sessions and personal tokens as cards
milestone: M16-front-design
package: web
writes:
  - apps/web/src/routes/account.tsx
  - apps/web/src/routes/account.css
conformance: []
modes: [local, hosted]
depends_on: [411]
status: draft
issue: 796
---

## What the user does
As a member, `/account` shows my profile (avatar, handle) at the top, then a Browser sessions card with a danger `Sign out everywhere` button, then a Personal tokens card with a `Table` of tokens or an `EmptyState`.

## Done when
- [ ] `/account` shows the profile header and the two `Card`s; with no personal token the tokens card shows an `EmptyState` explaining how to create one with `ob login`; with tokens it lists them in a `Table`

## Rules
- Use only the tokens and primitives of `docs/design.md` (ticket 411): no colour, radius, shadow or font size written as a raw value outside `apps/web/src/styles.css`.
- Styles live in a CSS file next to the page or component, scoped under one class on its root element; never append to `apps/web/src/styles.css` (except ticket 411).
- No new npm dependency (no Tailwind, no component kit): plain React and CSS.
- Keep every accessible name, role and label the Playwright specs in `apps/web/e2e/` use, so `web.yml` stays green without editing those specs.
- Check the pages you touch in a real browser (Playwright or the dev server) at 1280 px and 375 px wide, in light and dark (`prefers-color-scheme`), and say in the PR what you checked.

## Out of scope
Creating personal tokens from the page (not a feature yet). The top bar (412).
