---
id: 72
title: Delete a message, leaving a tombstone
milestone: M2-messages-and-threads
package: core
writes:
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
status: draft
claimed_by: null
issue: 72
---

## What the user does
As the author, I delete a message and its place in the thread remains.

## Done when
- [ ] `ob delete 3` succeeds; `ob read 3 --json` shows `deleted: true` and empty text; deleting it again is a no-op

## Out of scope
- Label lookups after a delete (83).
- Stale revisions (73).

## Notes
`docs/data-model.md` "How folds are derived".
