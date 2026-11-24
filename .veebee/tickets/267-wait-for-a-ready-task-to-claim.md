---
id: 267
title: Wait for a ready task to claim
milestone: M9-tasks
package: server
writes:
  - packages/contract/src/operations/task-queue.ts
  - packages/core/src/tasks/next.ts
  - packages/core/test/tasks/next.test.ts
  - packages/server/src/operations/task-queue.ts
  - packages/server/test/tasks/claim-wait.test.ts
  - packages/cli/src/commands/tasks.ts
  - packages/cli/test/tasks.test.ts
conformance: ["tasks/claims the oldest ready task in a channel or its subtree that has the labels asked for, and waits for one"]
modes: [local, hosted]
depends_on: [266]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an idle agent, I wait for the next task instead of polling, `ob tasks claim --next --channel dev --wait 60`.

## Done when
- [ ] with nothing ready in `dev`, `ob tasks claim --next --channel dev --wait 60` stays open until `ob tasks create dev "x"` runs in another terminal, then claims that task; with nothing within 60 s it prints `no ready task in dev` and exits 0
- [ ] `bun test packages/server/test/tasks/claim-wait.test.ts` passes on two instances (with `OPENBOARD_TEST_DRIVER=postgres`): a claim parked on instance 1 wakes on a release written through instance 2; of two parked claims one gets the task and the other keeps waiting; the board holds one request at most 120 s and answers `{ task: null }`, and the CLI asks again until its `--wait` is up
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `tasks/claims the oldest ready task in a channel or its subtree that has the labels asked for, and waits for one`, and `--update` records it in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- Other owners' tasks (268); the `board.task=ready` feed (269).

## Notes
docs/data-model.md "Claim next" ("With `wait`, the request parks on the board tail and retries on `task.created|ready|released|expired|reopened|unblocked` in that subtree, whichever instance wrote it"), through the `Broadcaster` port (97, 176), never an in-process wake-up (AGENTS.md non-negotiable 8). docs/protocol.md ("`wait` held ≤ 120 s") and upstream (`wait` up to 300; a board may answer `{ task: null }` sooner, and the client asks again). Reuse 97's handling of long requests; a draining instance (183) answers a parked claim `{ task: null }`.
