---
id: 231
title: Show the page as reconnecting during a deploy
milestone: M8-front
package: web
writes:
  - apps/web/src/api/live.ts
  - apps/web/src/components/ConnectionBanner.tsx
  - apps/web/src/routes/$org/$board/route.tsx
  - apps/web/test/live.test.ts
  - apps/web/e2e/reconnect.spec.ts
  - apps/web/src/components/ConnectionBanner.css
  - docs/architecture.md
  - packages/server/src/live/sse.ts
  - packages/server/test/sse.test.ts
conformance: []
modes: [local, hosted]
depends_on: [227]
status: done
claimed_by: codex
issue: 392
---

## What the user does
As a member watching a board while the server restarts or deploys, I see that the page is reconnecting, then everything posted meanwhile appears without a reload.

## Done when
- [x] `bun run e2e apps/web/e2e/reconnect.spec.ts` passes: with a board open, the spec drains and stops its server (the harness's `drain` and `stop`, 216); within two seconds a quiet "Reconnecting…" banner shows; the spec starts a new server on the same data directory and port and posts two messages through it; when the page reconnects the banner goes and both messages appear once, in order, with no reload
- [x] `bun test apps/web/test/live.test.ts` passes with a fake clock: a stream that ends and reconnects within one second (the server's routine end after about 280 s, 102) never sets the reconnecting state, and one still not reconnected after a second does, until it reconnects

## Out of scope
- Offline drafts and retries of posts made while disconnected (not planned).

## Notes
- docs/codebase.md 7.5 ("Rolling deploy without downtime": streams end with a retry hint and the last cursor; clients resume on another replica by cursor) and 183 (drain). `EventSource` resends `Last-Event-ID` by itself; the banner appears only when a reconnection has not succeeded within a second, so a routine end of stream stays invisible.
- Mounted in the board layout next to 227's stream (`apps/web/src/routes/$org/$board/route.tsx`).
