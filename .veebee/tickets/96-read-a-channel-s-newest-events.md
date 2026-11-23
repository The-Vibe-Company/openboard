---
id: 96
title: Read a channel's newest events
milestone: M3-live-tail
package: server
writes:
  - packages/contract/src/operations/events.ts
  - packages/server/src/operations/events.ts
  - packages/driver-sql/src/views/events.ts
  - packages/ports/testkit/store/events.test-suite.ts
  - packages/server/test/events.test.ts
  - packages/ports/src/store.ts
conformance: ["core/reads a channel's newest events, oldest first, and goes on from their cursor"]
modes: [local]
depends_on: [95]
status: draft
claimed_by: null
issue: 96
---

## What the user does
As an agent starting up, I read the last few things that happened and go on from there.

## Done when
- [ ] `curl 'http://127.0.0.1:8787/api/local/main/events?channel=dev&last=2'` answers the two newest events, oldest first, with a `cursor` to read on from
- [ ] `last` together with `after` answers 400 `invalid_request`

## Out of scope
- Streaming (99).

## Notes
`03-http.md` "Event feed" (`last`).
