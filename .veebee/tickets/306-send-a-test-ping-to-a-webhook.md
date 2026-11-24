---
id: 306
title: Send a test ping to a webhook
milestone: M11-webhooks-and-watchers
package: server
writes:
  - packages/contract/src/operations/webhooks.ts
  - packages/server/src/operations/webhooks.ts
  - packages/core/src/webhooks/payload.ts
  - packages/core/test/webhooks/payload.test.ts
  - packages/driver-sql/src/views/deliveries.ts
  - packages/server/src/jobs/webhooks.ts
  - packages/server/test/webhooks/ping.test.ts
  - docs/protocol.md
conformance: []
modes: [local, hosted]
depends_on: [282, 304]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a board admin wiring a receiver, I run `ob webhooks test <id>` and see whether my receiver accepted a signed ping, without waiting for a real event.

## Done when
- [ ] `bun test packages/server/test/webhooks/ping.test.ts` passes: `POST /x/webhooks/:id/test` sends at once a delivery whose body is `{ "type": "board.ping", "version": 1, "delivery", "board" }`, signed like every delivery, and answers `{ delivery: { id, status, ok, ms } }` with the receiver's status; a receiver answering 500 gives `ok: false` and the status, an unreachable one `ok: false` with `error: "unreachable"`; a ping is never retried and never counts toward disabling; an unknown or deleted webhook answers 404 `not_found`
- [ ] `ob webhooks test <id>` prints `delivered dl_… 200 in 12 ms`, or `error: remote_error: the receiver answered 500` and exits 1

## Out of scope
- Retries (307); the delivery log (308).

## Notes
docs/protocol.md "Board extensions" (`POST /x/webhooks/:id/test`). The ping payload's `type` is new: `board.ping` beside `board.event`, so a receiver can tell it apart; record it in docs/protocol.md "Delivery payload" (depends on 282, the last ticket before it to change that file). The ping goes through the same request builder (`webhooks/request.ts`) and target check as deliveries, synchronously in the request since the admin waits for it, and it is recorded as a delivery row with no event so it shows in the log (308).
