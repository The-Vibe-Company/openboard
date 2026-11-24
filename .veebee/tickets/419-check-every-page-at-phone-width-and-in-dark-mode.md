---
id: 419
title: Check every page at phone width and in dark mode on each pull request
milestone: M16-front-design
package: web
writes:
  - apps/web/e2e/visual.spec.ts
  - apps/web/playwright.config.ts
  - .github/workflows/web.yml
conformance: []
modes: [local, hosted]
depends_on: [412, 413, 414, 415, 416, 417, 418]
status: draft
issue: 797
---

## What the user does
As the owner, every pull request touching the front proves each page still fits a phone and works in dark mode, and leaves screenshots I can look at.

## Done when
- [ ] `bun run e2e apps/web/e2e/visual.spec.ts` visits every page (landing, sign-in, new, invitation, device, organization, organization settings tabs, channel, empty channel, thread, board settings tabs, account) at 1280 and 375 px in light and dark, fails if any has horizontal scroll, and saves one screenshot per page, width and theme
- [ ] `web.yml` uploads those screenshots as an artifact named `screenshots` on every run

## Rules
- Use only the tokens and primitives of `docs/design.md` (ticket 411): no colour, radius, shadow or font size written as a raw value outside `apps/web/src/styles.css`.
- Styles live in a CSS file next to the page or component, scoped under one class on its root element; never append to `apps/web/src/styles.css` (except ticket 411).
- No new npm dependency (no Tailwind, no component kit): plain React and CSS.
- Keep every accessible name, role and label the Playwright specs in `apps/web/e2e/` use, so `web.yml` stays green without editing those specs.
- Check the pages you touch in a real browser (Playwright or the dev server) at 1280 px and 375 px wide, in light and dark (`prefers-color-scheme`), and say in the PR what you checked.

## Out of scope
Pixel-diff baselines (screenshots are for people to look at, not compared).
