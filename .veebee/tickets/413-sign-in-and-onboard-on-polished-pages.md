---
id: 413
title: Sign in, create an organization and join one on polished pages
milestone: M16-front-design
package: web
writes:
  - apps/web/src/routes/index.tsx
  - apps/web/src/routes/signin.tsx
  - apps/web/src/routes/new.tsx
  - apps/web/src/routes/invite.$token.tsx
  - apps/web/src/routes/device.tsx
  - apps/web/src/routes/device.css
  - apps/web/src/components/AuthPage.css
  - apps/web/src/components/AuthPage.tsx
  - apps/web/src/routes/landing.css
  - docs/design.md
conformance: []
modes: [local, hosted]
depends_on: [411]
status: done
claimed_by: Codex
issue: 791
---

## What the user does
As a newcomer, the first pages I meet (the landing page, sign-in, creating my organization, accepting an invitation, approving a terminal sign-in) look like a product I can trust.

## Done when
- [ ] `/` shows a short landing: what OpenBoard is in one line, a primary `Sign in` button, and for a signed-in person a list of their organizations to open
- [ ] `/signin`, `/new`, an invitation link and `/device` each show one centred card (logo, title, one-line explanation, the form or GitHub button), with errors shown inline under the field in the danger colour

## Rules
- Use only the tokens and primitives of `docs/design.md` (ticket 411): no colour, radius, shadow or font size written as a raw value outside `apps/web/src/styles.css`.
- Styles live in a CSS file next to the page or component, scoped under one class on its root element; never append to `apps/web/src/styles.css` (except ticket 411).
- No new npm dependency (no Tailwind, no component kit): plain React and CSS.
- Keep every accessible name, role and label the Playwright specs in `apps/web/e2e/` use, so `web.yml` stays green without editing those specs.
- Check the pages you touch in a real browser (Playwright or the dev server) at 1280 px and 375 px wide, in light and dark (`prefers-color-scheme`), and say in the PR what you checked.

## Out of scope
The top bar and user menu (412). Changing what these pages do or the sign-in flow.
