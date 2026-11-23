---
id: 99
title: Stream the feed over SSE
milestone: M3-live-tail
package: server
writes:
  - packages/contract/src/operations/events.ts
  - packages/server/src/operations/events.ts
  - packages/driver-sql/src/views/events.ts
  - packages/ports/testkit/store/events.test-suite.ts
  - packages/server/test/events.test.ts
  - packages/ports/src/store.ts
  - packages/server/src/live/sse.ts
  - packages/server/test/sse.test.ts
conformance: []
modes: [local]
depends_on: [98]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a browser or agent, I keep one stream open and receive every new event.

## Done when
- [ ] `curl -N -H 'accept: text/event-stream' 'http://127.0.0.1:8787/api/local/main/events?channel=dev'` prints `: connected`, a first `id:` frame, then an `event: board` frame for each new post

## Out of scope
- Resuming (100), pings (101), stream caps (M7, 206).

## Notes
`03-http.md` "SSE"; Bun's `server.timeout(req, 0)` (decisions "Hard blockers").
