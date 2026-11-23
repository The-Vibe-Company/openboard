---
id: 67
title: Fetch one message without its thread
milestone: M2-messages-and-threads
package: server
writes:
  - packages/contract/src/operations/messages.ts
  - packages/server/src/operations/messages.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/ports/testkit/store/messages.test-suite.ts
  - packages/server/test/messages.test.ts
  - packages/ports/src/store.ts
conformance: []
modes: [local]
depends_on: [53]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an agent, I fetch a single message by its ID, without the rest of its thread.

## Done when
- [ ] `curl http://127.0.0.1:8787/api/local/main/posts/2` answers reply #2 alone, with its `re`

## Out of scope
- Thread reads (44, 84).

## Notes
`docs/protocol.md` route inventory (`GET /posts/:id`).
