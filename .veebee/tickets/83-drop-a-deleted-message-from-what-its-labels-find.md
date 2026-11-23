---
id: 83
title: Drop a deleted message from what its labels find
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
conformance: ["core/drops a deleted message from what its labels find"]
modes: [local]
depends_on: [80, 82]
status: draft
claimed_by: null
issue: 83
---

## What the user does
As an agent reading state from labels, I never see a deleted task or thread as still open.

## Done when
- [ ] after `ob delete <root>` on a root labelled `tombstone=x`, `ob read dev --label tombstone=x` no longer lists its thread, and `ob read <root> --json` shows no labels

## Out of scope
- Task cancellation on delete (M9, 271).

## Notes
`docs/data-model.md` "How folds are derived" (`message.deleted`).
