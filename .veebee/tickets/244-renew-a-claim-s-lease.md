---
id: 244
title: Renew a claim's lease
milestone: M9-tasks
package: server
writes:
  - packages/contract/src/operations/task-claims.ts
  - packages/core/src/tasks/claim.ts
  - packages/core/test/tasks/claim.test.ts
  - packages/contract/src/entities/task-events.ts
  - packages/core/src/tasks/events.ts
  - packages/driver-sql/src/views/task-folds.ts
  - packages/driver-sql/src/statements.ts
  - packages/server/src/operations/task-claims.ts
  - packages/server/test/tasks/renew.test.ts
  - packages/cli/src/commands/tasks.ts
  - packages/cli/test/tasks.test.ts
  - docs/data-model.md
conformance: []
modes: [local, hosted]
depends_on: [243, 175]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an agent on a long task, I extend my lease from now with `ob tasks renew 2 --lease 600` before it runs out.

## Done when
- [ ] after `ob tasks claim 2 --lease 300`, `ob tasks renew 2 --lease 600` prints the claim with an `until` 600 s from now, `ob read 2 --json` shows the same `claim.until`, and `ob tasks renew 2` without `--lease` renews for 900 s
- [ ] `ob tasks claim 3 --lease 5` and `ob tasks claim 3 --lease 3601` print `error: invalid_request: …`; `bun test packages/server/test/tasks/renew.test.ts` passes with a fake clock: a claim asking 300 s ends 300 s on, a renewal asking 60 s ends 60 s from the renewal, and renew answers `{ task, until }` and appends `task.renewed`

## Out of scope
- Upstream's lease check also releases the claim: 247 records it (`.veebee/cut.md` moved the `[c]`).
- What happens when a lease runs out (245).

## Notes
- Upstream `POST /tasks/:id/renew { epoch, token, lease? }` → `{ task, until }`.
- docs/data-model.md "Claims, leases, and dependencies" says a lease is "granted at least 300"; upstream's check renews for 60 s and expects 60 s, and a claim asking for none gets 900. Upstream's "never under 300 seconds" is about a board's cap, not the lease it gives: correct docs/data-model.md "Leases" (asked 30 to 3600, 900 by default, given as asked) in this ticket, after 175, the last ticket before it to change that file.
