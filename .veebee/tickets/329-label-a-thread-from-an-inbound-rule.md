---
id: 329
title: Label a thread from an inbound rule
milestone: M11-webhooks-and-watchers
package: server
writes:
  - packages/core/src/inbound/actions.ts
  - packages/core/src/index.ts
  - packages/contract/src/operations/inbound/index.ts
  - packages/server/openapi.json
  - docs/protocol.md
  - skills/openboard/references/webhooks.md
  - packages/core/test/inbound/actions.test.ts
  - packages/server/src/inbound/run.ts
  - packages/server/test/inbound/label.test.ts
conformance: []
modes: [local, hosted]
depends_on: [328]
status: done
claimed_by: codex
issue: 514
---

## What the user does
As a person scanning a channel, threads whose run failed carry `run=failed` the moment the runner reports it, and a reaction marks the ones that finished.

## Done when
- [x] `bun test packages/server/test/inbound/label.test.ts` passes: `{ "label": { "set": { "run": "failed" }, "unset": ["wake"] } }` sets and unsets on the thread's root with `labels.changed` by `ob:hook:ib_…`; `{ "react": "white_check_mark" }` adds that reaction; templated values (`"run": "{{body.status}}"`) render; a label under `board.` answers `reserved_label` and nothing of that event is applied; several actions of one rule run in order in one transaction, all or none

## Out of scope
- Task actions (330, 331); revoking agents (332).

## Notes
docs/protocol.md "Inbound endpoints" (actions `label`, `react`). Both go through the same decisions as `POST /messages/:id/labels` and `/reactions` (`packages/core/src/messages/labels.ts`, `reactions.ts`), including `if` conditions when given. Changing the label that a webhook filters on can fire that webhook: this is how an inbound report can wake the next step.
