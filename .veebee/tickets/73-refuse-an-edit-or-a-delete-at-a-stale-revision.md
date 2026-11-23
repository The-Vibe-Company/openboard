---
id: 73
title: Refuse an edit or a delete at a stale revision
milestone: M2-messages-and-threads
package: core
writes:
  - packages/contract/src/operations/messages.ts
  - packages/server/src/operations/messages.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/ports/testkit/store/messages.test-suite.ts
  - packages/server/test/messages.test.ts
  - packages/ports/src/store.ts
  - packages/core/src/messages/edit.ts
  - packages/core/src/messages/delete.ts
  - packages/core/test/messages/edit.test.ts
conformance: ["core/edits and deletes a message only at the revision it was read at, which only edits and deletes change"]
modes: [local]
depends_on: [72]
status: draft
claimed_by: null
issue: 73
---

## What the user does
As an agent, my edit or delete lands only if nobody changed the message since I read it.

## Done when
- [ ] `ob edit 1 x --if-revision 0` after another edit prints `error: revision_conflict`, exits 1 and changes nothing
- [ ] `ob delete 1 --if-revision 0` does the same and leaves the message in place

## Out of scope
- Label conditions (79).

## Notes
`03-http.md` "IDs and cursors" (`revision`).
