---
id: 412
title: Move between organizations, boards and channels in a Vercel-style app shell
milestone: M16-front-design
package: web
writes:
  - apps/web/src/components/Header.tsx
  - apps/web/src/components/Header.css
  - apps/web/src/components/ChannelList.tsx
  - apps/web/src/components/ChannelList.css
  - apps/web/src/components/Switcher.tsx
  - apps/web/src/components/Switcher.css
  - apps/web/src/components/UserMenu.tsx
  - apps/web/src/components/UserMenu.css
  - apps/web/src/routes/__root.tsx
  - apps/web/src/routes/$org/$board/route.tsx
  - apps/web/src/routes/$org/$board/shell.css
  - apps/web/src/api/orgs.ts
  - apps/web/e2e/account.spec.ts
  - apps/web/e2e/board.spec.ts
  - apps/web/e2e/signin.spec.ts
  - docs/auth.md
conformance: []
modes: [local, hosted]
depends_on: [411]
status: done
claimed_by: Codex
issue: 790
---

## What the user does
As a member, I see where I am and move around like in the Vercel dashboard: a top bar with the logo, then `org / board` switchers, and my avatar menu; on a board, a left sidebar lists its channels and links to its settings.

## Done when
- [x] On a board page the top bar reads `OpenBoard / <org> / <board>`; opening the org or board switcher lists the organizations and boards I belong to and picking one navigates there; the avatar opens a menu with Account and Sign out
- [x] The board sidebar lists the channels with the current one highlighted, plus Settings; at 375 px wide the sidebar hides behind a menu button and the page has no horizontal scroll

## Rules
- Use only the tokens and primitives of `docs/design.md` (ticket 411): no colour, radius, shadow or font size written as a raw value outside `apps/web/src/styles.css`.
- Styles live in a CSS file next to the page or component, scoped under one class on its root element; never append to `apps/web/src/styles.css` (except ticket 411).
- No new npm dependency (no Tailwind, no component kit): plain React and CSS.
- Keep every accessible name, role and label the Playwright specs in `apps/web/e2e/` use, so `web.yml` stays green without editing those specs.
- Check the pages you touch in a real browser (Playwright or the dev server) at 1280 px and 375 px wide, in light and dark (`prefers-color-scheme`), and say in the PR what you checked.

## Out of scope
The content of the channel, thread and settings pages (414 to 417). Creating an organization or board from the switcher (the existing `/new` and settings pages stay the way to do it; a link to them is enough).
