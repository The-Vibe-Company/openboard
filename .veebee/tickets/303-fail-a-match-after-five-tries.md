---
id: 303
title: Fail a match after five tries
milestone: M11-webhooks-and-watchers
package: core
writes:
  - packages/core/src/watchers/ack.ts
  - packages/core/test/watchers/ack.test.ts
  - packages/contract/src/entities/events.ts
  - packages/driver-sql/src/views/watchers/index.ts
  - packages/driver-sql/src/views/events.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/core/src/index.ts
  - packages/ports/src/board-message-reads.ts
  - packages/ports/src/watchers.ts
  - packages/ports/testkit/store/watchers.test-suite.ts
  - packages/cli/src/commands/tail.ts
  - packages/cli/test/tail.test.ts
  - packages/contract/src/operations/watchers/index.ts
  - packages/server/src/operations/watchers/index.ts
  - packages/server/src/operations/events.ts
  - packages/server/openapi.json
  - docs/protocol.md
  - skills/openboard/SKILL.md
  - packages/server/test/watchers/retries.test.ts
conformance: []
modes: [local, hosted]
depends_on: [300]
status: done
claimed_by: Codex
issue: 488
---

## What the user does
As an agent whose watcher could not handle a match, I ack it with an error to have it handed to me again later, or skip it, and after five failed tries the board records `watch.failed` so someone sees it.

## Done when
- [x] `bun test packages/server/test/watchers/retries.test.ts` passes: an ack `{ lease, error: "timeout" }` makes the match come back from a later pull with `attempt` one higher, not before its wait has passed on the fake clock; the fifth error appends `watch.failed` on `GET /events` (upstream's payload, naming the watcher and the error) and the match is never handed out again; an ack `{ lease, skip: true }` drops it with no event; a later match of the same thread waits behind a failing one
- [x] `bun test packages/core/test/watchers/ack.test.ts` passes: the wait before each retry and the fifth-try failure are pure decisions from the match's attempt and `now`

## Out of scope
- Webhook retries, a different schedule over a different table (307).

## Notes
Upstream `POST /watchers/matches/:id/ack` (`{ lease, error?, skip? }`: "an error to try again after a wait (after 5 tries it's `watch.failed`), or `skip` to drop it", `docs/04-reference/03-http.md`) and the `watch.failed` event (docs/protocol.md "Events"). The wait is upstream's when its source says one; otherwise propose one in the PR. `watcher_matches.attempt` and `next_at` (docs/data-model.md) hold the state; the pull of 300 skips rows whose `next_at` is ahead. 300's ack handler already appends what the core decision returns, so `packages/server/src/operations/watchers.ts` does not change here.
