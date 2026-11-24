---
id: 403
title: Fan out committed events to tails without re-reading the store
milestone: M3-live-tail
package: server
writes:
  - packages/server/src/live/long-poll.ts
  - packages/server/src/live/sse.ts
  - packages/server/src/live/fan-out.ts
  - packages/server/test/live/fan-out.test.ts
  - packages/driver-sql/src/local-broadcaster.ts
  - packages/ports/src/broadcaster.ts
  - tools/bench/budgets.json
  - packages/ports/src/store.ts
  - packages/ports/src/index.ts
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/views/events.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/server/src/operations/events.ts
  - packages/server/test/sse.test.ts
  - docs/architecture.md
conformance: []
modes: [local, hosted]
depends_on: [108]
status: claimed
claimed_by: claude-403
issue: 603
---

## What the user does
As an operator with many agents tailing one board, a post reaches every tail within the architecture's 5 ms budget instead of each tail re-reading the store.

## Done when
- [ ] `bun run bench --quick` with 50 SSE tails shows write-to-last-frame p99 at or under 5 ms locally, and `tools/bench/budgets.json` records the new, lower numbers
- [ ] the HTTP and SSE tests still pass on SQLite and Postgres, a slow tail never delays the others (each tail keeps at most one queued page, then catches up from the store), and a filtered tail still receives only matching events

## Out of scope
- Cross-instance delivery (176): this ticket speeds up delivery inside one instance.

## Notes
Found by ticket 108's bench (#108): 50 SSE tails measured ~10.6 ms p50 / ~16 ms p99 write-to-last-frame against the 5 ms target in docs/architecture.md, because every wake makes every tail run its own store read. Deliver the committed page once, in memory, to the subscribers it matches (filters applied once per distinct filter where possible), and fall back to a store read only when a tail is behind or its queue is full. Keep authorization unchanged: a tail only ever receives what its caller's `can` lets it read (`keepInsideCan` rules), and revocation handling stays ticket 182's.
