---
id: 79
title: Refuse a label write whose condition no longer holds
milestone: M2-messages-and-threads
package: core
writes:
  - packages/contract/src/operations/messages.ts
  - packages/server/src/operations/messages.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/ports/testkit/store/messages.test-suite.ts
  - packages/server/test/messages.test.ts
  - packages/ports/src/store.ts
  - packages/core/src/messages/labels.ts
  - packages/core/test/messages/labels.test.ts
conformance: ["core/labels a message only while its labels are as the write says, one of any that race"]
modes: [local]
depends_on: [78]
status: draft
claimed_by: null
issue: null
---

## What the user does
As one of several agents, I take a piece of work by labelling it only if it is still as I read it.

## Done when
- [ ] `ob label 1 status=done --if status=open` when the status is already `done` prints `error: label_conflict`, exits 1 and changes nothing
- [ ] `ob label 1 owner=me --if-unset owner` on a message that has an `owner` does the same

## Out of scope
- Task claims (M9).

## Notes
`vb label` reference (`--if`, `--if-unset`); race-free under the board lock.
