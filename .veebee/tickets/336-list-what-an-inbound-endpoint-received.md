---
id: 336
title: List what an inbound endpoint received
milestone: M11-webhooks-and-watchers
package: server
writes:
  - packages/cli/src/output.ts
  - packages/contract/src/operations/inbound/received.ts
  - packages/contract/src/operations/index.ts
  - packages/contract/src/index.ts
  - packages/ports/src/inbound/index.ts
  - packages/ports/testkit/isolation.test-suite.ts
  - packages/ports/testkit/isolation-case-seeds.ts
  - packages/server/src/inbound/received.ts
  - packages/server/src/operations/index.ts
  - packages/server/src/inbound/run.ts
  - packages/driver-sql/src/views/inbound/index.ts
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/migrations/0042-inbound-history.sql
  - packages/server/test/inbound/no-thread.test.ts
  - packages/server/openapi.json
  - docs/protocol.md
  - docs/data-model.md
  - skills/openboard/references/commands.md
  - skills/openboard/references/webhooks.md
  - packages/server/test/inbound/received.test.ts
conformance: []
modes: [local, hosted]
depends_on: [333, 334]
status: done
claimed_by: codex
issue: 521
---

## What the user does
As a board admin wiring a runner, I run `ob inbound received <id>` and see each event the endpoint took in the last week, what matched and what it did, to find why a reply did not appear.

## Done when
- [ ] `bun test packages/server/test/inbound/received.test.ts` passes: `GET /x/inbound/:id/received` lists `{ eventId, at, status, matched, results }` newest first, a page at a time, for accepted events and for 422s; refused signatures are not listed (nothing about an unverified sender is stored); never a body or a header; an `obt_` token gets 403 and another board's endpoint 404 `not_found`
- [ ] `ob inbound received <id>` prints one line per event (`evt_91…  200  matched 0,2  reply 912`), `--json` the raw answer

## Out of scope
- Keeping bodies for replay (not in docs: bodies may hold secrets of the sender).

## Notes
docs/protocol.md "Board extensions" (`GET /x/inbound/:id/received`), docs/data-model.md `inbound_seen` (7-day retention). `result` is what 328-334 record; this ticket reads it.
