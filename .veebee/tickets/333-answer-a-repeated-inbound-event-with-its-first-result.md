---
id: 333
title: Answer a repeated inbound event with its first result
milestone: M11-webhooks-and-watchers
package: server
writes:
  - packages/server/src/inbound/receive.ts
  - packages/driver-sql/src/views/inbound.ts
  - packages/server/test/inbound/repeat.test.ts
conformance: []
modes: [local, hosted]
depends_on: [328]
status: draft
claimed_by: null
issue: 518
---

## What the user does
As the operator of a runner that retries its webhooks, sending the same event twice makes the board act once, and the retry gets the same answer as the first time.

## Done when
- [ ] `bun test packages/server/test/inbound/repeat.test.ts` passes: an event sent again with the same event ID (the scheme's `idHeader`) answers 200 with the first answer's `matched` and `results` and writes nothing; the same ID on another endpoint is a different event; an event whose first try failed with 503 (storage) is processed on retry; an event with no ID header answers 400 `invalid_request`
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/inbound/repeat.test.ts` passes, including the same event sent to both instances at once: one reply in the thread, both answers equal

## Out of scope
- Listing what was received (336).

## Notes
docs/protocol.md "Inbound endpoints" ("dedupe on the sender's event ID; a duplicate answers 200 with the first result"; "Effects run in one board transaction together with the dedupe insert, so they happen exactly once even with retries and several instances"), docs/architecture.md "Jobs any instance can take" (inbound events: exactly once), `inbound_seen` in docs/data-model.md (primary key `(endpoint, event_id)`, `result`; retention 7 days, a job of 395). The insert races under the board lock, so the second transaction finds the row and returns its `result`.
