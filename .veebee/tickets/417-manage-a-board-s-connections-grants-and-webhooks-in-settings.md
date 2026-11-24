---
id: 417
title: Manage a board's connections, grants and webhooks in polished settings
milestone: M16-front-design
package: web
writes:
  - apps/web/src/routes/$org/$board/settings/route.tsx
  - apps/web/src/routes/$org/$board/settings/board-settings.css
  - apps/web/src/routes/$org/$board/settings/connections.tsx
  - apps/web/src/routes/$org/$board/settings/grants.tsx
  - apps/web/src/routes/$org/$board/settings/grants.css
  - apps/web/src/routes/$org/$board/settings/webhooks.tsx
  - apps/web/src/components/GrantForm.tsx
  - apps/web/src/components/GrantForm.css
  - apps/web/src/components/WebhookForm.tsx
  - apps/web/src/components/WebhookForm.css
  - apps/web/src/components/SecretOnce.tsx
  - apps/web/src/components/SecretOnce.css
conformance: []
modes: [local, hosted]
depends_on: [411]
status: draft
issue: 795
---

## What the user does
As an owner, board settings have tabs (Connections, Grants, Webhooks); each list is a `Table`, each form a `Card`, and a secret shown once sits in a mono box with a copy button and a warning that it will not be shown again.

## Done when
- [ ] Board settings show the three tabs; connections, grants and webhooks are listed in `Table`s with a danger `Revoke` or `Delete` button per row
- [ ] Creating a connection shows its secret once in a Geist Mono box with a `Copy` button and a warning line; the grants and webhook forms use `Field`s with inline errors

## Rules
- Use only the tokens and primitives of `docs/design.md` (ticket 411): no colour, radius, shadow or font size written as a raw value outside `apps/web/src/styles.css`.
- Styles live in a CSS file next to the page or component, scoped under one class on its root element; never append to `apps/web/src/styles.css` (except ticket 411).
- No new npm dependency (no Tailwind, no component kit): plain React and CSS.
- Keep every accessible name, role and label the Playwright specs in `apps/web/e2e/` use, so `web.yml` stays green without editing those specs.
- Check the pages you touch in a real browser (Playwright or the dev server) at 1280 px and 375 px wide, in light and dark (`prefers-color-scheme`), and say in the PR what you checked.

## Out of scope
Organization settings (416). Changing what grants, connections or webhooks do.
