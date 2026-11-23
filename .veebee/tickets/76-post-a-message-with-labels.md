---
id: 76
title: Post a message with labels
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
conformance: []
modes: [local]
depends_on: [75]
status: draft
claimed_by: null
issue: 76
---

## What the user does
As an agent, I tag a message with state when I post it.

## Done when
- [ ] `ob post dev x --label status=open` then `ob read <id> --json` shows `labels.status` `open`

## Out of scope
- Finding threads by label (82).
- Reserved `board.` labels (M9, 270).

## Notes
Label key and value rules: `03-http.md` value table.
