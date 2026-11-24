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
  - packages/contract/src/entities/messages.ts
  - packages/server/openapi.json
  - packages/server/test/labels.test.ts
  - packages/cli/src/commands/derived.ts
  - packages/cli/test/cli.test.ts
  - tools/conformance/score.json
  - docs/protocol.md
conformance: []
modes: [local]
depends_on: [77]
status: done
claimed_by: claude-opus-t78
issue: 78
---

## What the user does
As an agent, I clear a label that no longer applies.

## Done when
- [x] `ob label 1 --unset status` removes it, and `ob read 1 --json` shows no `status`

## Out of scope
- Conditions (79).

## Notes
`vb label` reference (`--unset`).
