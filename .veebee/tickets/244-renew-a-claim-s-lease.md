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
  - docs/protocol.md
  - packages/cli/src/commands/derived.ts
  - packages/cli/src/commands/tasks/claim.ts
  - packages/cli/src/commands/tasks/renew.ts
  - packages/contract/src/entities/events.ts
  - packages/contract/src/index.ts
  - packages/contract/src/operations/index.ts
  - packages/contract/src/operations/tasks/claim.ts
  - packages/contract/src/operations/tasks/renew.ts
  - packages/core/src/index.ts
  - packages/core/src/tasks/renew.ts
  - packages/driver-sql/src/views/events.ts
  - packages/driver-sql/src/views/tasks/task-folds.ts
  - packages/server/openapi.json
  - packages/server/src/operations/events.ts
  - packages/server/src/operations/index.ts
  - packages/server/src/operations/tasks/renew.ts
  - packages/server/test/isolation/cases.ts
  - skills/openboard/references/commands.md
  - packages/contract/src/operations/events.ts
conformance: []
modes: [local, hosted]
depends_on: [243, 175]
status: done
claimed_by: codex
issue: 417
---

## What the user does
As an agent on a long task, I extend my lease from now with `ob tasks renew 2 --lease 600` before it runs out.

## Done when
- [x] after `ob tasks claim 2 --lease 300`, `ob tasks renew 2 --lease 600` prints the claim with an `until` 600 s from now, `ob read 2 --json` shows the same `claim.until`, and `ob tasks renew 2` without `--lease` renews for 900 s
- [x] `ob tasks claim 3 --lease 5` and `ob tasks claim 3 --lease 3601` print `error: invalid_request: …`; `bun test packages/server/test/tasks/renew.test.ts` passes with a fake clock: a claim asking 300 s ends 300 s on, a renewal asking 60 s ends 60 s from the renewal, and renew answers `{ task, until }` and appends `task.renewed`

## Out of scope
- Upstream's lease check also releases the claim: 247 records it (`.veebee/cut.md` moved the `[c]`).
- What happens when a lease runs out (245).

## Notes
- Upstream `POST /tasks/:id/renew { epoch, token, lease? }` → `{ task, until }`.
- docs/data-model.md "Claims, leases, and dependencies" says a lease is "granted at least 300"; upstream's check renews for 60 s and expects 60 s, and a claim asking for none gets 900. Upstream's "never under 300 seconds" is about a board's cap, not the lease it gives: correct docs/data-model.md "Leases" (asked 30 to 3600, 900 by default, given as asked) in this ticket, after 175, the last ticket before it to change that file.
