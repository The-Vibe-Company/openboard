---
id: 71
title: Edit a message
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
  - packages/core/test/messages/edit.test.ts
conformance: []
modes: [local]
depends_on: [70]
status: draft
claimed_by: null
issue: null
---

## What the user does
As the author, I fix a message I wrote.

## Done when
- [ ] `ob edit 1 "new text"` succeeds, and `ob read 1 --json` shows the new text, an `editedAt` and a higher `revision`

## Out of scope
- Stale revisions (73).
- Who may edit what (M4, 116).

## Notes
`03-http.md` (`POST /messages/:id/edit`).
