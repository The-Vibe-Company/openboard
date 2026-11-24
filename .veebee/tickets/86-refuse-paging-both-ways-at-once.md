---
id: 86
title: Refuse paging both ways at once
milestone: M2-messages-and-threads
package: server
writes:
  - tools/conformance/score.json
  - packages/cli/src/commands/read.ts
  - packages/cli/test/read-thread.test.ts
  - packages/server/openapi.json
  - docs/protocol.md
  - packages/contract/src/operations/threads.ts
  - packages/server/src/operations/threads.ts
  - packages/driver-sql/src/views/threads.ts
  - packages/ports/testkit/store/threads.test-suite.ts
  - packages/server/test/threads.test.ts
  - packages/ports/src/store.ts
conformance: ["paging/refuses to page threads back and forward at once"]
modes: [local]
depends_on: [85]
status: done
claimed_by: claude-t86
issue: 86
---

## What the user does
As an agent, I am told when I ask for two directions at once.

## Done when
- [x] `curl 'http://127.0.0.1:8787/api/local/main/threads?channel=dev&before=<older>&after=1'` answers 400 `invalid_request`, and `ob read dev --before <older> --after 1` prints that error and exits 1

## Out of scope
- Unreadable `older` values: 400 `invalid_cursor` comes with 85.

## Notes
`03-http.md` "Listing threads".
