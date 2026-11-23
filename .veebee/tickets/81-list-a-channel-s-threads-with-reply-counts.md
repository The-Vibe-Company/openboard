---
id: 81
title: List a channel's threads with reply counts
milestone: M2-messages-and-threads
package: server
writes:
  - packages/contract/src/operations/threads.ts
  - packages/server/src/operations/threads.ts
  - packages/driver-sql/src/views/threads.ts
  - packages/ports/testkit/store/threads.test-suite.ts
  - packages/server/test/threads.test.ts
  - packages/ports/src/store.ts
  - packages/cli/src/commands/read.ts
  - docs/protocol.md
  - packages/cli/src/commands/index.ts
  - packages/cli/src/commands/messages.ts
  - packages/cli/src/main.ts
  - packages/cli/test/cli.test.ts
  - packages/cli/test/read-channel.test.ts
  - packages/cli/test/read-thread.test.ts
  - packages/contract/src/entities/threads.ts
  - packages/contract/src/index.ts
  - packages/contract/src/operations/index.ts
  - packages/contract/src/operations/messages.ts
  - packages/server/openapi.json
  - packages/server/src/operations/index.ts
conformance: []
modes: [local]
depends_on: [47, 50]
status: done
claimed_by: codex
issue: 81
---

## What the user does
As a person or agent, I see a channel as its threads, each with how many replies it has and the latest one.

## Done when
- [x] `ob read dev` lists each thread once, the latest activity last, with its reply count and latest reply

## Out of scope
- Filtering by label (82), paging (85), search (87).

## Notes
`03-http.md` "Listing threads"; `vb read <channel>` lists threads. The flat channel reader moves to `ob messages <channel>`, retaining its cursor, limit, and continuation line.
