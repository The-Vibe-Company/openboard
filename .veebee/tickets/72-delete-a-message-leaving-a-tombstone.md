---
id: 72
title: Delete a message, leaving a tombstone
milestone: M2-messages-and-threads
package: core
writes:
  - .veebee/tickets/72-delete-a-message-leaving-a-tombstone.md
  - README.md
  - packages/contract/src/entities/events.ts
  - packages/contract/src/index.ts
  - packages/contract/src/operations/index.ts
  - packages/core/src/index.ts
  - packages/driver-sql/src/views/events.ts
  - packages/server/openapi.json
  - packages/server/src/operations/events.ts
  - packages/server/src/operations/index.ts
  - tools/conformance/score.json
  - packages/contract/src/operations/messages.ts
  - packages/server/src/operations/messages.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/ports/testkit/store/messages.test-suite.ts
  - packages/server/test/messages.test.ts
  - packages/ports/src/store.ts
  - packages/core/src/messages/delete.ts
  - packages/core/test/messages/delete.test.ts
conformance: ["core/deletes a message, leaving a tombstone"]
modes: [local]
depends_on: [71]
status: done
claimed_by: codex
issue: 72
---

## What the user does
As the author, I delete a message and its place in the thread remains.

## Done when
- [x] `ob delete 3` succeeds; `ob read 3 --json` shows `deleted: true` and empty text; deleting it again is a no-op

## Out of scope
- Label lookups after a delete (83).
- Stale revisions (73).

## Notes
`docs/data-model.md` "How folds are derived".
