---
id: 44
title: Read a thread by its ID
milestone: M1-walking-skeleton
package: server
writes:
  - packages/contract/src/operations/threads.ts
  - packages/server/src/operations/threads.ts
  - packages/driver-sql/src/views/threads.ts
  - packages/ports/testkit/store/threads.test-suite.ts
  - packages/server/test/threads.test.ts
  - packages/ports/src/store.ts
  - packages/contract/src/entities/threads.ts
  - packages/cli/src/commands/read.ts
  - packages/contract/src/index.ts
  - packages/contract/src/operations/index.ts
  - packages/server/src/operations/index.ts
  - packages/ports/testkit/index.ts
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/statements.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/cli/test/read-thread.test.ts
  - tools/bench/test/counters.test.ts
conformance: []
modes: [local]
depends_on: [36]
status: claimed
claimed_by: claude-opus-5-5
issue: 44
---

## What the user does
As a person or agent, I open one message as a thread by its ID.

## Done when
- [ ] `ob read 1` prints #1 as a thread with no replies
- [ ] `curl http://127.0.0.1:8787/api/local/main/messages/1` answers `{ message, replies: [] }` with `message.id` `"1"`

## Out of scope
- Replies (45).
- A message that does not exist (50).
- Reading after one of its messages (84).

## Notes
`docs/codebase.md` 4.3; IDs as decimal strings (`docs/data-model.md` "IDs and cursors").
