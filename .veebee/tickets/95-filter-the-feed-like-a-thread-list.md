---
id: 95
title: Filter the feed like a thread list
milestone: M3-live-tail
package: server
writes:
  - packages/contract/src/operations/events.ts
  - packages/contract/src/entities/events.ts
  - packages/contract/src/operations/thread-filters.ts
  - packages/contract/src/operations/threads.ts
  - packages/core/src/index.ts
  - packages/server/src/operations/threads.ts
  - packages/server/openapi.json
  - docs/protocol.md
  - tools/conformance/score.json
  - packages/contract/src/operation.ts
  - packages/driver-postgres/test/testkit.test.ts
  - packages/server/src/auth/access.ts
  - packages/server/test/isolation/cases.ts
  - packages/server/test/isolation/seed.ts
  - packages/server/test/isolation/isolation.test.ts
  - packages/server/src/operations/events.ts
  - packages/driver-sql/src/views/events.ts
  - packages/driver-sql/src/views/actors.ts
  - packages/driver-sqlite/test/open.test.ts
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/migrations/0010-event-message-history.sql
  - packages/ports/testkit/store/events.test-suite.ts
  - packages/ports/testkit/isolation.test-suite.ts
  - packages/server/test/events.test.ts
  - packages/ports/src/store.ts
  - packages/ports/src/board-message-reads.ts
  - packages/core/src/threads/filters.ts
  - packages/core/test/threads/filters.test.ts
conformance: ["core/reads events after a cursor, each with a cursor of its own"]
modes: [local]
depends_on: [90, 94]
status: done
claimed_by: codex
issue: 95
---

## What the user does
As an agent, I follow only the events of the channels and labels I work on.

## Done when
- [x] `curl 'http://127.0.0.1:8787/api/local/main/events?after=0&channel=dev'` lists only `dev` events, and adding `&label=status=open` only that thread's

## Out of scope
- `last` (96).

## Notes
`03-http.md` "Filters" (shared with `GET /threads`; an event matches when its message matched before or after it).
