---
id: 102
title: End a stream before the platform's time limit
milestone: M3-live-tail
package: server
writes:
  - packages/server/src/live/sse.ts
  - packages/server/test/sse.test.ts
conformance: []
modes: [local]
depends_on: [101]
status: draft
claimed_by: null
issue: 102
---

## What the user does
As a client, my stream ends cleanly before a proxy cuts it, with a cursor to resume from.

## Done when
- [ ] a stream ends by itself after about 280 seconds, and reconnecting from its last `id:` misses nothing

## Out of scope
- Draining on deploy (M6, 183).

## Notes
`03-http.md` "SSE".
