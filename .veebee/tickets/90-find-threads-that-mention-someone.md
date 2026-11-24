---
id: 90
title: Find threads that mention someone
milestone: M2-messages-and-threads
package: server
writes:
  - packages/contract/src/operations/threads.ts
  - packages/server/src/operations/threads.ts
  - packages/driver-sql/src/views/threads.ts
  - packages/ports/testkit/store/threads.test-suite.ts
  - packages/server/test/threads.test.ts
  - packages/ports/src/store.ts
  - packages/core/src/threads/filters.ts
  - packages/core/src/index.ts
  - packages/core/test/threads/filters.test.ts
  - packages/cli/src/commands/read.ts
  - packages/cli/test/read-channel.test.ts
  - packages/server/openapi.json
  - docs/protocol.md
conformance: []
modes: [local]
depends_on: [80, 89]
status: claimed
claimed_by: claude-opus-5-5
issue: 90
---

## What the user does
As a person, I find every thread where someone called me in.

## Done when
- [ ] `ob read dev --mentions me` lists only threads with a message mentioning me

## Out of scope
- Notifications.

## Notes
`03-http.md` "Filters" (`mentions`, `me`).
