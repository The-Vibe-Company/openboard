---
id: 101
title: Keep a quiet stream open with pings
milestone: M3-live-tail
package: server
writes:
  - packages/server/src/live/sse.ts
  - packages/server/test/sse.test.ts
conformance: []
modes: [local]
depends_on: [100]
status: draft
claimed_by: null
issue: 101
---

## What the user does
As a client behind a proxy, my quiet stream is not cut for idleness.

## Done when
- [ ] a stream with no traffic prints `: ping` every 15 seconds

## Out of scope
- Ending streams (102).

## Notes
`03-http.md` "SSE".
