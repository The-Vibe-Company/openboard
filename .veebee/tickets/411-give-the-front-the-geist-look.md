---
id: 411
title: Give the front the Geist look: tokens, primitives and base styles
milestone: M16-front-design
package: web
writes:
  - apps/web/src/styles.css
  - apps/web/src/ui/**
  - apps/web/src/assets/geist-mono.woff2
  - apps/web/src/assets/LICENSE-geist.txt
  - docs/design.md
  - docs/codebase.md
conformance: []
modes: [local, hosted]
depends_on: []
status: done
claimed_by: codex
issue: 789
---

## What the user does
As a member, every OpenBoard page looks like a finished Vercel-style product (Geist type, quiet greys, black primary buttons, thin borders) instead of browser defaults, in light and dark.

## Done when
- [ ] Opening `/signin`, a board's channel and `/account` on `ob serve` shows no browser-default blue underlined link or grey bevelled button: text, links, buttons, inputs and focus rings follow `docs/design.md`, in light and in dark mode
- [ ] `apps/web/src/ui/` exports `Button` (primary, secondary, tertiary, danger; small and medium; a pending state), `Input`, `Textarea`, `Select`, `Field` (label, hint, error), `Card`, `Badge`, `Table`, `EmptyState` and `Avatar`, each with its own CSS file, and `bun run verify` and `bun run e2e` (local project) pass

## Rules
- Use only the tokens and primitives of `docs/design.md` (ticket 411): no colour, radius, shadow or font size written as a raw value outside `apps/web/src/styles.css`.
- Styles live in a CSS file next to the page or component, scoped under one class on its root element; never append to `apps/web/src/styles.css` (except ticket 411).
- No new npm dependency (no Tailwind, no component kit): plain React and CSS.
- Keep every accessible name, role and label the Playwright specs in `apps/web/e2e/` use, so `web.yml` stays green without editing those specs.
- Check the pages you touch in a real browser (Playwright or the dev server) at 1280 px and 375 px wide, in light and dark (`prefers-color-scheme`), and say in the PR what you checked.

## Out of scope
Restyling each page and the app shell (tickets 412 to 418). Replacing existing markup with the primitives is those tickets' job; this one only changes base element styles and adds the primitives.

## Notes
The look is Vercel's Geist dashboard. Write it down in `docs/design.md` (the reference the next tickets follow) as CSS custom properties on `:root`, redefined under `@media (prefers-color-scheme: dark)`:
- Type: Geist Sans (already in `assets/`), Geist Mono for ids, secrets, code, timestamps (add `geist-mono.woff2` with its SIL OFL licence file). Base 14 px, line height 1.5; headings tight (letter-spacing -0.02em to -0.04em), page titles 24–32 px, never the current 4rem hero.
- Colours: background `#fff` / `#0a0a0a`; raised surface `#fafafa` / `#111`; border `#eaeaea` / `#262626`; text `#171717` / `#ededed`; muted text `#666` / `#a1a1a1`; accent and focus ring `#0070f3` / `#3291ff`; danger `#e5484d`; success `#45a557`; warning `#f5a623`.
- Shapes: radius 6 px on controls, 8 px on cards, 9999 px on avatars and badges; 1 px borders; shadows only on menus and dialogs. Spacing on a 4 px scale. Controls 32 px (small) and 40 px (medium) high.
- Buttons: primary is solid text-colour with background-colour text (black on light, white on dark); secondary is bordered; tertiary is text only; danger is red. Links are text-coloured, underline on hover only.
- Focus: a 2 px accent ring with 2 px offset on every interactive element (`:focus-visible`).
`styles.css` keeps only fonts, tokens, resets and base element styles; it is the one file this milestone lets grow.
