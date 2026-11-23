---
id: 77
title: Label a message
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
conformance: ["core/raises the version with each edit, reaction, and label"]
modes: [local]
depends_on: [76]
status: claimed
claimed_by: claude-opus-t77
issue: 77
---

## What the user does
As an agent, I change a message's state label after the fact.

## Done when
- [ ] `ob label 1 status=done` sets it, and `ob read 1 --json` shows a `version` above the one before; `ob edit` and `ob react` raise it too

## Out of scope
- Removing labels (78), conditions (79).

## Notes
`version` is the event ID of the last change (`docs/data-model.md` "IDs and cursors").
