---
id: 308
title: Dead-letter a delivery after its last attempt
milestone: M11-webhooks-and-watchers
package: server
writes:
  - docs/data-model.md
  - docs/decisions.md
  - docs/protocol.md
  - packages/cli/src/output.ts
  - packages/cli/test/webhooks.test.ts
  - packages/contract/src/entities/webhooks/delivery.ts
  - packages/contract/src/index.ts
  - packages/contract/src/operations/index.ts
  - packages/contract/src/operations/webhooks/deliveries.ts
  - packages/core/src/index.ts
  - packages/core/src/webhooks/outcome.ts
  - packages/driver-sql/migrations/0035-webhook-delivery-history.sql
  - packages/driver-sql/src/views/webhooks/deliveries.ts
  - packages/driver-sql/src/views/webhooks/webhooks.ts
  - packages/ports/src/webhooks/index.ts
  - packages/ports/testkit/index.ts
  - packages/ports/testkit/isolation.test-suite.ts
  - packages/ports/testkit/store/webhooks.test-suite.ts
  - packages/server/openapi.json
  - packages/server/src/operations/index.ts
  - packages/server/src/operations/webhooks/deliveries.ts
  - packages/server/src/operations/webhooks/index.ts
  - packages/server/src/webhooks/send.ts
  - packages/server/test/webhooks/dead.test.ts
  - packages/server/test/webhooks/template.test.ts
  - skills/openboard/SKILL.md
  - skills/openboard/references/commands.md
conformance: []
modes: [local, hosted]
depends_on: [307]
status: done
claimed_by: codex-308
issue: 493
---

## What the user does
As a board admin, I run `ob webhooks deliveries <id> --state dead` and see which deliveries my receiver never accepted, with the last status and error of each.

## Done when
- [ ] `bun test packages/server/test/webhooks/dead.test.ts` passes: a delivery still failing after its tenth attempt (the ninth retry, 12 h) is `dead` and never sent again; `GET /x/webhooks/:id/deliveries` lists deliveries newest first, a page at a time, each `{ id, event, thread, state, attempt, lastStatus, lastError, createdAt, doneAt }`, filtered by `state`; another board's webhook ID answers 404 `not_found`
- [ ] `ob webhooks deliveries <id> --state dead` prints one line per delivery (`dl_…  dead  attempt 10  503`), `--json` the raw answer

## Out of scope
- Sending a dead delivery again (309); disabling on many dead deliveries (311); the page in settings (337).

## Notes
docs/protocol.md "Dead letters" and "Board extensions" (`GET /x/webhooks/:id/deliveries`). `last_error` is a short class (`timeout`, `unreachable`, `tls`, `status`), never the receiver's body. Its own contract and handler files so 309-311 do not compete with 306's.
