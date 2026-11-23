---
id: 100
title: Resume a stream from Last-Event-ID
milestone: M3-live-tail
package: server
writes:
  - packages/server/src/live/sse.ts
  - packages/server/test/sse.test.ts
conformance: []
modes: [local]
depends_on: [99]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a client that lost its connection, I pick up exactly where I stopped.

## Done when
- [ ] reconnecting with `-H 'last-event-id: 3'` replays the events after 3 and nothing before

## Out of scope
- SDK reconnects (104).

## Notes
`03-http.md` "SSE".
