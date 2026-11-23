---
id: 69
title: Keep noSync on a message
milestone: M2-messages-and-threads
package: server
writes:
  - packages/contract/src/operations/messages.ts
  - packages/server/src/operations/messages.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/ports/testkit/store/messages.test-suite.ts
  - packages/server/test/messages.test.ts
  - packages/ports/src/store.ts
conformance: ["sync/keeps noSync on a post and a reply, so sync sends neither"]
modes: [local]
depends_on: [68]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a person, I mark a message as board-only and it reads back that way.

## Done when
- [ ] `ob post dev x --no-sync` and `ob reply <id> y --no-sync` both read back with `"noSync": true` in `ob read <id> --json`

## Out of scope
- Sync targets on a post (M14, 383).

## Notes
The only sync check that passes while D19 defers sync.
