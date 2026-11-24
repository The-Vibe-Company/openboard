---
id: 398
title: Apply the event-log compaction policy
milestone: M15-operations
package: server
writes:
  - packages/driver-sql/src/views/compaction.ts
  - packages/driver-sql/src/statements.ts
  - packages/ports/src/store.ts
  - packages/server/src/jobs/compact.ts
  - packages/server/src/jobs/registry.ts
  - packages/server/test/ha/compact.test.ts
  - docs/data-model.md
  - docs/decisions.md
conformance: []
modes: [local, hosted]
depends_on: [394, 396, 397]
status: draft
claimed_by: null
issue: 593
---

## What the user does
As the operator, a busy board's log stops growing with bookkeeping that no one will ever read again, while every message, task and configuration event, and everything a restore or a reprojection needs, stays.

## Done when
- [ ] `grep -n "compaction" docs/decisions.md docs/data-model.md` shows the policy the owner approved, recorded as a decision and stated in docs/data-model.md "Boards and the log" beside "Append only" as the second exception
- [ ] `bun test packages/server/test/ha/compact.test.ts` passes on SQLite and on Postgres with both runners polling: with the proposed policy, `actor.seen` events older than 30 days that are neither an actor's first nor its latest are deleted by exactly one runner, only once log shipping (210, 388) has shipped them when it is configured; afterwards a reprojection (397) gives fold tables byte for byte equal to those before, `GET /events?all=true` pages across the gaps with valid cursors, and no other event type is touched

## Out of scope
- Removing or archiving message, task, grant or configuration events: the log is the source of every fold and of restores (D10, D25).
- Sweeping operational tables (395).

## Notes
- **No doc designs this** (cut question 8); this ticket proposes the policy and stops with `needs-decision` until the owner approves or replaces it. Proposed: the log is append-only and kept whole, except `actor.seen` bookkeeping (`visibility = 1`), which a board writes on every new sighting of an actor and which only the `actors` fold reads: keep each actor's first and latest, delete the rest after 30 days. Folds read `first_seen` from the first and the rest from the latest, so a reprojection is unchanged; cursors are log positions (D9), so gaps are allowed.
- docs/data-model.md "Boards and the log" ("Append only: no `UPDATE` or `DELETE` on `events` except the organization hard-delete job") must name this job as the second exception.
- On Postgres, deletes run in batches under no board lock (they change no fold), with an index on `(board_id, type, actor, id)` if `EXPLAIN` asks for one (165's registry).
- Depends on 396 and 394, the last tickets before it to change `packages/server/src/jobs/registry.ts` and docs/decisions.md.
