---
id: 247
title: Release a claim
milestone: M9-tasks
package: server
writes:
  - packages/contract/src/operations/task-claims.ts
  - packages/core/src/tasks/release.ts
  - packages/core/test/tasks/release.test.ts
  - packages/contract/src/entities/task-events.ts
  - packages/core/src/tasks/events.ts
  - packages/driver-sql/src/views/task-folds.ts
  - packages/driver-sql/src/statements.ts
  - packages/server/src/operations/task-claims.ts
  - packages/server/test/tasks/release.test.ts
  - packages/cli/src/commands/tasks.ts
  - packages/cli/src/claims.ts
  - packages/cli/test/tasks.test.ts
conformance: ["tasks/gives a claim the lease it asks for, up to 5 minutes, and says when it ends"]
modes: [local, hosted]
depends_on: [245]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an agent that cannot finish, I give a task back with `ob tasks release 2`, ready for someone else at once.

## Done when
- [ ] after `ob tasks claim 2`, `ob tasks release 2` prints `released 2`; `ob read 2 --json` shows `ready`, `claim: null` and `epoch: 1`; `ob tasks claim 2` then takes it with `epoch: 2`
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `tasks/gives a claim the lease it asks for, up to 5 minutes, and says when it ends`, and `--update` records it in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- Failing instead (248); refusing a release by a lost claim (249).

## Notes
- Upstream `POST /tasks/:id/release { epoch, token }` → `{ task }`, `task.released`. Depends on 245, not only 244 as first cut: both change the claim's rule and folds.
- Upstream's lease check (claim for 300 s, renew for 60 s, release, claim with no lease for at least 5 minutes, 400 for 5 s) needs release, so `.veebee/cut.md` moved its `[c]` here from 244.
