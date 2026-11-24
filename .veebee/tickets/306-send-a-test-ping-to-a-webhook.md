---
id: 306
title: Send a test ping to a webhook
milestone: M11-webhooks-and-watchers
package: server
writes:
  - apps/openboard/src/compose.ts
  - packages/contract/src/operations/webhooks/index.ts
  - packages/server/src/operations/webhooks/index.ts
  - packages/core/src/webhooks/payload.ts
  - packages/driver-sql/src/views/webhooks/deliveries.ts
  - packages/server/src/jobs/webhooks.ts
  - packages/server/test/webhooks/ping.test.ts
  - packages/server/test/isolation/cases.ts
  - docs/protocol.md
  - packages/driver-sql/migrations/0034-webhook-pings.sql
  - .veebee/tickets/306-send-a-test-ping-to-a-webhook.md
  - docs/data-model.md
  - docs/decisions.md
  - packages/cli/src/output.ts
  - packages/contract/src/index.ts
  - packages/contract/src/operations/index.ts
  - packages/core/src/index.ts
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/views/webhooks/webhooks.ts
  - packages/driver-sqlite/src/ddl.ts
  - packages/driver-sqlite/src/migrate.ts
  - packages/driver-sqlite/test/webhook-migration.test.ts
  - packages/ports/src/webhooks/index.ts
  - packages/ports/testkit/isolation.test-suite.ts
  - packages/server/openapi.json
  - packages/server/src/operations/index.ts
  - packages/server/src/webhooks/request.ts
  - packages/server/src/webhooks/send.ts
  - skills/openboard/references/commands.md
  - skills/openboard/references/webhooks.md
conformance: []
modes: [local, hosted]
depends_on: [282, 304]
status: done
claimed_by: codex
issue: 491
---

## What the user does
As a board admin wiring a receiver, I run `ob webhooks test <id>` and see whether my receiver accepted a signed ping, without waiting for a real event.

## Done when
- [x] `bun test packages/server/test/webhooks/ping.test.ts` passes: `POST /x/webhooks/:id/test` sends at once a delivery whose body is `{ "type": "board.ping", "version": 1, "delivery", "board" }`, signed like every delivery, and answers `{ delivery: { id, status, ok, ms } }` with the receiver's status; a receiver answering 500 gives `ok: false` and the status, an unreachable one `ok: false` with `error: "unreachable"`; a ping is never retried and never counts toward disabling; an unknown or deleted webhook answers 404 `not_found`
- [x] `ob webhooks test <id>` prints `delivered dl_… 200 in 12 ms`, or `error: remote_error: the receiver answered 500` and exits 1

## Out of scope
- Retries (307); the delivery log (308).

## Notes
docs/protocol.md "Board extensions" (`POST /x/webhooks/:id/test`). The ping payload's `type` is new: `board.ping` beside `board.event`, so a receiver can tell it apart; record it in docs/protocol.md "Delivery payload" (depends on 282, the last ticket before it to change that file). The ping goes through the same request builder (`webhooks/request.ts`) and target check as deliveries, synchronously in the request since the admin waits for it, and it is recorded as a delivery row with no event so it shows in the log (308).
