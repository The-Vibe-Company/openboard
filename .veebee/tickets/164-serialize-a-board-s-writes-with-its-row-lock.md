---
id: 164
title: Serialize a board's writes with its row lock
milestone: M5-postgres-driver
package: driver-postgres
writes:
  - bun.lock
  - packages/driver-postgres/package.json
  - packages/driver-postgres/test/lock.test.ts
  - packages/driver-postgres/src/pool.ts
conformance: []
modes: [hosted]
depends_on: [163]
status: done
claimed_by: codex
issue: 244
---

## What the user does
As an agent writing to a board through several servers at once, every write gets the next position and none is lost or reordered.

## Done when
- [x] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/driver-postgres/test/lock.test.ts` passes: three stores (three pools) on one database post 60 messages to one board concurrently, and the board's events are exactly 1 to 60, each once, while a reader polling `id > cursor` throughout sees every one of them in order and never a gap it later fills
- [x] in the same file, writes to two different boards from two pools overlap in time (neither waits for the other's commit), and a write that throws after appending leaves the board's head unchanged

## Out of scope
- Lock timeouts answering 503 `unavailable` (172).
- The D37 timeline guard (M6, 185).
- Pipelining a write's statements (174 counts round trips).

## Notes
- The lock already exists: every write opens with `boardStatements.lockBoard` (`packages/driver-sql/src/views/boards.ts`), rendered with ` FOR UPDATE` on Postgres by the `forUpdate` fragment, and `writer.append` (`packages/driver-sql/src/views/messages.ts`) checks each event follows the head. This ticket proves the argument of docs/data-model.md "Per-board serialization" across pools; docs/codebase.md's `lock.ts` is only needed if the race shows a gap.
- `pool.ts` is in `writes` only for a fix the race exposes (for example a transaction whose statements do not all run on the reserved connection of `sql.begin`).
- No wall-clock waits: overlap is shown with an explicit barrier (a write that holds its transaction open until the other board's write has committed), not with timers.
