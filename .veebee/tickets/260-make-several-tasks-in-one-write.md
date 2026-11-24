---
id: 260
title: Make several tasks in one write
milestone: M9-tasks
package: server
writes:
  - packages/contract/src/operations/task-batches.ts
  - packages/contract/src/operations/index.ts
  - packages/core/src/tasks/batch.ts
  - packages/core/test/tasks/batch.test.ts
  - packages/ports/src/tasks.ts
  - packages/ports/testkit/store/tasks.test-suite.ts
  - packages/ports/testkit/isolation.test-suite.ts
  - packages/driver-sql/migrations/*-task-batches.sql
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/views/tasks.ts
  - packages/driver-sql/src/views/task-folds.ts
  - packages/driver-sql/src/statements.ts
  - packages/server/src/operations/task-batches.ts
  - packages/server/src/operations/index.ts
  - packages/server/test/tasks/batch.test.ts
  - packages/server/test/isolation/cases.ts
  - packages/cli/src/commands/tasks.ts
  - packages/cli/test/tasks.test.ts
conformance: ["tasks/makes several tasks in one write, in the order given: each waits for the ones it names, of the batch or there already, and an id makes them once"]
modes: [local, hosted]
depends_on: [259]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a planner, I lay out a small plan as tasks in one write, `ob tasks create dev --file plan.json`, each waiting for the ones it names.

## Done when
- [ ] with `plan.json` holding `[{"key":"fix","text":"fix it"},{"text":"review it","needs":[{"key":"fix"}]}]`, `ob tasks create dev --file plan.json --idempotency-key plan-1` prints a row per task in the order given, `fix it` `ready` and `review it` `waiting` on `fix it`'s ID; run again, it prints the same tasks and makes none
- [ ] the same key with another plan, or one more task, prints `error: duplicate_id: …`; `bun test packages/server/test/tasks/batch.test.ts` passes, `GET /tasks/batch/plan-1` answering the batch's roots as they are now and 404 `batch_not_found` for an ID the caller made none under
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `tasks/makes several tasks in one write, in the order given: each waits for the ones it names, of the batch or there already, and an id makes them once`, and `--update` records it in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- A batch that cannot be made in full (261).

## Notes
- Upstream `POST /tasks/batch { channel, tasks, id? }` (1 to 100 tasks, each `{ key?, text, labels?, noSync?, attachments?, needs?, for? }`; `needs` take an ID or `{ key }`) and `GET /tasks/batch/:id`; all in one board write, no event of any before all have landed; the `id`'s digest is of the request as sent. `ob tasks create <channel> --file <path>` (`-` reads stdin) sends one batch.
- `task_batches` (`principal`, `id`, `digest`, `tasks`; migration `*-task-batches.sql`) is a fold in docs/data-model.md, so a batch's ID and digest must come back by replay: say in the PR which event carries them.
