---
id: 98
title: Show bookkeeping events with all
milestone: M3-live-tail
package: server
writes:
  - packages/contract/src/operations/events.ts
  - packages/server/src/operations/events.ts
  - packages/driver-sql/src/views/events.ts
  - packages/ports/testkit/store/events.test-suite.ts
  - packages/server/test/events.test.ts
  - packages/ports/src/store.ts
  - packages/ports/src/board-message-reads.ts
  - packages/contract/src/entities/events.ts
  - packages/server/openapi.json
  - docs/protocol.md
conformance: []
modes: [local]
depends_on: [53, 97]
status: done
claimed_by: claude-t98
issue: 98
---

## What the user does
As an operator, I see the board's bookkeeping events when I ask for them.

## Done when
- [x] `curl 'http://127.0.0.1:8787/api/local/main/events?after=0&all=true'` includes `actor.seen`; without `all` it does not; `all=maybe` answers 400

## Out of scope
- `ob.*` events, which never reach the feed (M4 audit, 132).

## Notes
`03-http.md` "Event feed" (`all`).
