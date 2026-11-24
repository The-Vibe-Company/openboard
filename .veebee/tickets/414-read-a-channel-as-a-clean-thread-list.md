---
id: 414
title: Read a channel as a clean list of threads
milestone: M16-front-design
package: web
writes:
  - apps/web/src/routes/$org/$board/index.tsx
  - apps/web/src/routes/$org/$board/channel.css
  - apps/web/src/components/ThreadList.tsx
  - apps/web/src/components/ThreadList.css
  - apps/web/src/components/ThreadRow.tsx
  - apps/web/src/components/ThreadRow.css
  - apps/web/src/components/EmptyChannel.tsx
  - apps/web/src/components/EmptyChannel.css
  - apps/web/src/components/Composer.tsx
  - apps/web/src/components/Composer.css
  - apps/web/src/components/ConnectionBanner.tsx
  - apps/web/src/components/ConnectionBanner.css
  - apps/web/src/markdown.ts
  - apps/web/test/markdown.test.ts
  - docs/design.md
conformance: []
modes: [local, hosted]
depends_on: [411]
status: done
claimed_by: codex
issue: 792
---

## What the user does
As a member, a channel reads like a Vercel list: one row per thread with the author's avatar and name, the first line of the thread, its reply count and a relative time, and a composer at the bottom.

## Done when
- [ ] A channel with threads shows one row per thread (avatar, author, first line truncated to one line, reply count, relative time in muted text) separated by 1 px borders, with a hover state; a new thread arriving live appears at the top without a layout jump
- [ ] An empty channel shows an `EmptyState` with the `ob post` command in Geist Mono and a copy button; the composer is a bordered textarea with a primary `Post` button; the reconnecting banner is a slim warning bar

## Rules
- Use only the tokens and primitives of `docs/design.md` (ticket 411): no colour, radius, shadow or font size written as a raw value outside `apps/web/src/styles.css`.
- Styles live in a CSS file next to the page or component, scoped under one class on its root element; never append to `apps/web/src/styles.css` (except ticket 411).
- No new npm dependency (no Tailwind, no component kit): plain React and CSS.
- Keep every accessible name, role and label the Playwright specs in `apps/web/e2e/` use, so `web.yml` stays green without editing those specs.
- Check the pages you touch in a real browser (Playwright or the dev server) at 1280 px and 375 px wide, in light and dark (`prefers-color-scheme`), and say in the PR what you checked.

## Out of scope
The thread page (415). The sidebar and top bar (412).
