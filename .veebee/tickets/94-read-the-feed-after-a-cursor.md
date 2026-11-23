---
id: 94
title: Read the feed after a cursor
milestone: M3-live-tail
package: server
writes:
  - packages/contract/src/operations/events.ts
  - packages/server/src/operations/events.ts
  - packages/driver-sql/src/views/events.ts
  - packages/ports/testkit/store/events.test-suite.ts
  - packages/server/test/events.test.ts
  - packages/ports/src/store.ts
  - packages/contract/src/entities/events.ts
conformance: []
modes: [local]
depends_on: [36]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an agent, I read what happened on the board since a cursor.

## Done when
- [ ] `curl 'http://127.0.0.1:8787/api/local/main/events?after=0'` answers `{ events, cursor }` with a `message.posted` event for #1 whose `cursor` is `"1"`
- [ ] reading again `after` that answer's `cursor` repeats none of those events

## Out of scope
- Filters (95), long-poll (97), SSE (99).

## Notes
`03-http.md` "Event feed" and "Long-poll".
