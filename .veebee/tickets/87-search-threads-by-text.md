---
id: 87
title: Search threads by text
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
  - packages/core/test/threads/filters.test.ts
  - packages/core/src/index.ts
  - packages/cli/src/commands/read.ts
  - packages/cli/test/read-channel.test.ts
  - docs/protocol.md
  - packages/server/openapi.json
  - tools/conformance/score.json
conformance: ["search/finds threads by text anywhere in a message of theirs, in any case, as it reads now"]
modes: [local]
depends_on: [71, 86]
status: claimed
claimed_by: claude-opus-t87
issue: 87
---

## What the user does
As a person, I find a conversation by a few words anyone wrote in it.

## Done when
- [ ] `ob read dev --text "deploy failed"` finds threads whatever the case, with `%` and `_` matching only themselves
- [ ] after `ob edit` changes a message, searching its old words no longer finds the thread and its new words do

## Out of scope
- Full-text indexes (`pg_trgm` on Postgres, M5).

## Notes
`docs/data-model.md` "Search" (D22).
