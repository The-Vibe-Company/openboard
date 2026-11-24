---
id: 227
title: See a new message arrive live
milestone: M8-front
package: web
writes:
  - apps/web/src/api/live.ts
  - apps/web/src/routes/$org/$board/route.tsx
  - apps/web/test/live.test.ts
  - apps/web/e2e/live.spec.ts
conformance: []
modes: [local, hosted]
depends_on: [102, 224]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a member watching a board, a message an agent posts appears in the channel and in the open thread within a second, without reloading.

## Done when
- [ ] `bun run e2e apps/web/e2e/live.spec.ts` passes: with `/acme/main?channel=dev` open, a post made through the API with a connection secret appears at the top of the list, a reply to an open thread appears at its end, and an edit and a delete show up in place, each within one second and without a reload
- [ ] `bun test apps/web/test/live.test.ts` passes: board events map to the queries they refresh (a post in another channel refreshes only that channel's list and the channel's count), several events arriving together cause one refetch per query, and the stream's last `id:` is kept for the next connection

## Out of scope
- Showing that the stream is reconnecting (231).
- Task events (M9, 273).

## Notes
- docs/architecture.md "What the server provides for the front" (the SPA uses the same SSE; `EventSource` sends the session cookie) and "SSE and long-poll on any instance"; upstream's SSE on `GET {BOARD_URL}/events` (99-102: frames, pings, the 280 s end, `Last-Event-ID` resume). One stream per open board, mounted in the board layout (`apps/web/src/routes/$org/$board/route.tsx`, 222); events invalidate TanStack Query keys from `apps/web/src/api/board.ts` and `api/thread.ts`, so the page re-reads through the same routes it renders from rather than patching lists by hand.
- Depends on 102 (the SSE route as M3 finishes it), which the front had no path to before: M3's tickets are not ancestors of M5 onward in `.veebee/cut.md`.
