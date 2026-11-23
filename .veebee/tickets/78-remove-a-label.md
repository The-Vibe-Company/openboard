---
id: 78
title: Remove a label
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
depends_on: [77]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an agent, I clear a label that no longer applies.

## Done when
- [ ] `ob label 1 --unset status` removes it, and `ob read 1 --json` shows no `status`

## Out of scope
- Conditions (79).

## Notes
`vb label` reference (`--unset`).
