---
id: 230
title: Scroll a long channel smoothly
milestone: M8-front
package: web
writes:
  - apps/web/src/components/ThreadList.tsx
  - apps/web/src/api/board.ts
  - apps/web/e2e/scroll.spec.ts
conformance: []
modes: [local, hosted]
depends_on: [223]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a member of a busy board, I scroll back through thousands of threads in a channel without the page slowing down.

## Done when
- [ ] `bun run e2e apps/web/e2e/scroll.spec.ts` passes: in a channel of 2,000 threads posted through the API, the page holds fewer than 100 thread rows in the DOM at any time, scrolling to the end loads older pages until the first thread shows, and no page of threads is requested twice
- [ ] in the same spec, returning from a thread puts the list back at the row that was opened

## Out of scope
- Long threads (a thread's replies are paged by 84 and rendered as they come; not virtualized here).
- Search in the front (not planned in the cut).

## Notes
- D6 (TanStack Virtual) and docs/project.md M8 ("virtualized lists"). Pages come from upstream's thread list with its cursor (`before`, 85); the infinite query lives in `apps/web/src/api/board.ts` (222), and live updates (227) keep invalidating only its first page.
- Depends on 223 because both change `apps/web/src/components/ThreadList.tsx`.
