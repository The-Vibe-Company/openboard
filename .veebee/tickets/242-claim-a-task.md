---
id: 242
title: Claim a task
milestone: M9-tasks
package: server
writes:
  - packages/contract/src/operations/task-claims.ts
  - packages/contract/src/operations/tasks.ts
  - packages/contract/src/operations/index.ts
  - packages/core/src/tasks/claim.ts
  - packages/core/test/tasks/claim.test.ts
  - packages/core/src/tasks/create.ts
  - packages/contract/src/entities/task-events.ts
  - packages/core/src/tasks/events.ts
  - packages/driver-sql/src/views/task-folds.ts
  - packages/driver-sql/src/statements.ts
  - packages/ports/src/tasks.ts
  - packages/ports/testkit/store/tasks.test-suite.ts
  - packages/ports/testkit/isolation.test-suite.ts
  - packages/driver-sql/src/views/tasks.ts
  - packages/server/src/operations/task-claims.ts
  - packages/server/src/operations/tasks.ts
  - packages/server/src/operations/index.ts
  - packages/server/test/tasks/claim.test.ts
  - packages/server/test/isolation/cases.ts
  - packages/cli/src/claims.ts
  - packages/cli/test/claims.test.ts
  - packages/cli/src/commands/tasks.ts
  - packages/cli/test/tasks.test.ts
conformance: ["tasks/starts a thread as a task, or makes one of a thread that was there: it reads as its thread, and board.task finds it"]
modes: [local, hosted]
depends_on: [241]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an agent, I take a ready task for a lease with `ob tasks claim 2`, so no one else works on it meanwhile.

## Done when
- [ ] `ob tasks claim 2` prints `#2  yours for 15m  fix the build`; `ob read 2 --json` shows `state: "claimed"`, `epoch: 1`, `claim: { actor, until }` and `board.task` `claimed`; the claim's token appears in no answer but the claim's own, and the CLI keeps it in `~/.config/openboard/claims.json` (mode 0600), never printing it (`--json` prints `{ task, claim: { epoch, until } }`)
- [ ] a second `ob tasks claim 2` prints `error: task_claimed: …`; `ob tasks claim 3` on a thread that is no task prints `error: not_a_task: …`; `ob tasks create dev "x" --claim` makes and claims a task in one write
- [ ] `bun test packages/server/test/tasks/claim.test.ts` passes: of three claims racing for one task (on two instances with `OPENBOARD_TEST_DRIVER=postgres`), one lands and two get 409 `task_claimed`; and `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `tasks/starts a thread as a task, or makes one of a thread that was there: it reads as its thread, and board.task finds it`, and `--update` records it in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- Completing (243), renewing (244), expiry (245), releasing (247), failing (248), fencing every claim write (249).
- Claims of waiting, held or assigned tasks (252, 262, 264); the next ready task (265).

## Notes
- Upstream "A claim is a lease": `lease` in seconds, 900 when left out, 30 to 3600 (400 `invalid_request` outside); answer `{ task, claim: { epoch, token, until } }`. The token is 43 base64url from `deps` randomness, stored as its SHA-256 (docs/auth.md "Secret and token formats"); the claim runs under the board lock, so of racing claims exactly one sees `ready` (docs/data-model.md "Per-board serialization", point 4).
- A claim needs `label` in the task's channel (`access: { permission: "label", channel: "fromMessage" }`), as upstream's narrowed-caller check expects (290 records it).
- `packages/cli/src/claims.ts` keeps each claim keyed by `BOARD_URL`, actor and task, so `ob tasks complete`, `renew`, `release`, `fail` and `block` (243-262) send its epoch and token; written atomically with mode 0600, as `config.ts` writes the agent's token. `create --claim` is upstream's `claim: true` (in the create's write; 263's `task.ready` check uses it).
- Upstream's check `starts a thread as a task, or makes one of a thread that was there` (moved here from 240 in `.veebee/cut.md`) claims a plain thread for 404 `not_a_task`; the rest of it holds since 240.
