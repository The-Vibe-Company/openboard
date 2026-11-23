---
id: 95
title: Filter the feed like a thread list
milestone: M3-live-tail
package: server
writes:
  - packages/contract/src/operations/events.ts
  - packages/server/src/operations/events.ts
  - packages/driver-sql/src/views/events.ts
  - packages/ports/testkit/store/events.test-suite.ts
  - packages/server/test/events.test.ts
  - packages/ports/src/store.ts
  - packages/core/src/threads/filters.ts
  - packages/core/test/threads/filters.test.ts
conformance: ["core/reads events after a cursor, each with a cursor of its own"]
modes: [local]
depends_on: [90, 94]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an agent, I follow only the events of the channels and labels I work on.

## Done when
- [ ] `curl 'http://127.0.0.1:8787/api/local/main/events?after=0&channel=dev'` lists only `dev` events, and adding `&label=status=open` only that thread's

## Out of scope
- `last` (96).

## Notes
`03-http.md` "Filters" (shared with `GET /threads`; an event matches when its message matched before or after it).
