---
id: 415
title: Read a thread with readable messages and task states
milestone: M16-front-design
package: web
writes:
  - apps/web/src/routes/$org/$board/t/$id.tsx
  - apps/web/src/routes/$org/$board/t/thread.css
  - apps/web/src/components/MessageView.tsx
  - apps/web/src/components/MessageView.css
  - apps/web/src/components/markdown.css
  - apps/web/src/components/TaskList.tsx
  - apps/web/src/components/TaskList.css
  - apps/web/src/components/TaskState.tsx
  - apps/web/src/components/TaskState.css
conformance: []
modes: [local, hosted]
depends_on: [411]
status: draft
issue: 793
---

## What the user does
As a member, a thread reads like a clean conversation: each message with avatar, author, a muted mono timestamp, and its Markdown typeset (headings, lists, links, inline code and code blocks in Geist Mono on a raised surface); tasks show their state as a coloured badge.

## Done when
- [ ] A thread with a message holding a heading, a list, a link, inline code and a fenced code block shows each typeset per `docs/design.md`, the code block scrolling horizontally inside its box at 375 px instead of widening the page
- [ ] Task states show as `Badge`s (open, claimed, done, failed, canceled, expired with distinct token colours), and the reply composer sits at the bottom of the thread

## Rules
- Use only the tokens and primitives of `docs/design.md` (ticket 411): no colour, radius, shadow or font size written as a raw value outside `apps/web/src/styles.css`.
- Styles live in a CSS file next to the page or component, scoped under one class on its root element; never append to `apps/web/src/styles.css` (except ticket 411).
- No new npm dependency (no Tailwind, no component kit): plain React and CSS.
- Keep every accessible name, role and label the Playwright specs in `apps/web/e2e/` use, so `web.yml` stays green without editing those specs.
- Check the pages you touch in a real browser (Playwright or the dev server) at 1280 px and 375 px wide, in light and dark (`prefers-color-scheme`), and say in the PR what you checked.

## Out of scope
The channel list and composer styles (414). Changing how Markdown is parsed or sanitised (`markdown.ts` stays as is).
