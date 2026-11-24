---
id: 238
title: Start a thread as a task
milestone: M9-tasks
package: server
writes:
  - .veebee/tickets/238-start-a-thread-as-a-task.md
  - docs/protocol.md
  - packages/cli/src/output.ts
  - packages/driver-sqlite/test/open.test.ts
  - packages/ports/src/board-message-reads.ts
  - packages/server/openapi.json
  - skills/openboard/references/commands.md
  - packages/server/src/operations/messages.ts
  - packages/contract/src/entities/tasks.ts
  - packages/contract/src/entities/task-events.ts
  - packages/contract/src/entities/events.ts
  - packages/contract/src/entities/messages.ts
  - packages/contract/src/operations/tasks/create.ts
  - packages/contract/src/operations/index.ts
  - packages/contract/src/index.ts
  - packages/core/src/tasks/create.ts
  - packages/core/test/tasks/create.test.ts
  - packages/core/src/tasks/events.ts
  - packages/core/src/tasks/view.ts
  - packages/core/src/index.ts
  - packages/ports/src/tasks.ts
  - packages/ports/src/store.ts
  - packages/ports/src/index.ts
  - packages/ports/testkit/store/tasks.test-suite.ts
  - packages/ports/testkit/index.ts
  - packages/ports/testkit/isolation.test-suite.ts
  - packages/ports/testkit/isolation-seed.ts
  - packages/driver-sql/migrations/*-tasks.sql
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/statements.ts
  - packages/driver-sql/src/views/tasks/tasks.ts
  - packages/driver-sql/src/views/tasks/task-folds.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/driver-sql/src/views/events.ts
  - packages/server/src/operations/tasks.ts
  - packages/server/src/operations/index.ts
  - packages/server/src/operations/events.ts
  - packages/server/test/tasks/create.test.ts
  - packages/server/test/isolation/seed.ts
  - packages/server/test/isolation/cases.ts
  - packages/cli/src/commands/tasks.ts
  - packages/cli/src/commands/index.ts
  - packages/cli/test/tasks.test.ts
conformance: []
modes: [local, hosted]
depends_on: [99]
status: done
claimed_by: codex
issue: 411
---

## What the user does
As an agent, I post a piece of work as a task with `ob tasks create dev "fix the build"`, and its thread shows it ready for anyone to take.

## Done when
- [ ] on `ob serve`, `ob tasks create dev "fix the build"` prints the new task's ID (`2` on a fresh board), and `ob read 2 --json` shows the root with `task` `{ state: "ready", owner, by, for: null, needs: [], epoch: 0, claim: null, blocked: null, result: null, reason: null }` (`owner` and `by` the local owner) and `labels["board.task"]` `ready`
- [ ] `ob read dev --label board.task=ready` lists the thread, and `ob reply 2 "on it"` lands in its thread
- [ ] `bun test packages/server/test/tasks/create.test.ts` passes: `GET /events` shows the root's `message.posted` then `task.created` with upstream's payload and the task in its `message`; a caller without `post` in the channel, or without `label` for a task with `labels`, gets 403 `forbidden` and nothing is made; the isolation suites seed a task in each organization and stay green

## Out of scope
- Listing tasks (239); making a task of a thread that is there (240); client IDs (241).
- Claims (242), `needs` (252), `for` (264), batches (260).
- Refusing `board.` labels a write sets (270); the tasks list in the front (273).

## Notes
- Upstream `docs/04-reference/03-http.md` "Tasks" (`POST /tasks` with `channel` posts the root, so it takes `text`, `labels`, `noSync` and `id` as a post does; the caller's principal owns it) and `TaskView`, `CreateTaskBody` in `@vercel/board` 0.54.0 `dist/routes-*.d.mts`. docs/data-model.md "Board state (folds)" (`tasks`, `task_needs`) and "How folds are derived" (`task.created`: insert `tasks`, `task_needs`, the `board.task` label). `permissionsFor` in `packages/server/src/auth/access.ts` already asks `label` for a write with `labels`.
- First tasks ticket: it lays the area out for 239-272 so parallel tickets of M9 and M10 touch different files. Contract: the entity in `entities/tasks.ts`, the feed's task events in `entities/task-events.ts`, joined into `Event` in `entities/events.ts`; operations split by what they do, so no file passes 400 lines: `operations/tasks.ts` (create, list), `task-claims.ts`, `task-changes.ts`, `task-holds.ts`, `task-batches.ts`, `task-queue.ts`, with one server handler file each. Core: one rule per file under `packages/core/src/tasks/`, the events in `tasks/events.ts`, joined into `BoardEvent` in `core/src/index.ts`.
- Port: `packages/ports/src/store.ts` is at the 400-line limit. Put the task members in `packages/ports/src/tasks.ts` (read members `BoardView` extends, under-the-lock members `BoardWriter` extends), where later tickets append. Driver: reads in `driver-sql/src/views/tasks.ts`, folds in `views/task-folds.ts`; `appendEvent` in `views/messages.ts` hands every `task.*` event to one `foldTaskEvent`, so no later task event touches `messages.ts`. The fold keeps the root's precomputed `view` (with `task`), its `board.task` label and its label term in step, so thread reads, `GET /threads?label=board.task=ready` and the feed show the task without a join. Migration `*-tasks.sql`: `tasks` and `task_needs` as docs/data-model.md writes them (`claim_token` holds a SHA-256, never a token).
- The feed (`readEvents` in `server/src/operations/events.ts`, `views/events.ts`) serves `task.created` with its `message` view, as docs/protocol.md "Events" lists it.
- `ob tasks create <channel> "<text>"` is upstream's `vb tasks create`; printing the ID may need `packages/cli/src/commands/tasks.ts`, which later task commands share. `RefKind` already has `task`: seed one per organization in `packages/server/test/isolation/seed.ts` and `packages/ports/testkit/isolation-seed.ts`.
- Depends on 99 and 198 besides 215: M3 is not upstream of M7 (`.veebee/cut.md` "Could not place" 13), and 99 is the last ticket to change the feed's `operations/events.ts` and `views/events.ts`, 198 the last to change `views/messages.ts`; the task checks of 263, 267 and 269 also need the feed's filters, `wait` and the `Broadcaster` port (95-97).

Orchestrator note: the dependency on 215 (serving production) was dropped: it ordered milestones, it is not a technical need, and 215 waits on the owner's production secrets, which would hold every feature milestone behind them.
The dependency on 198 (only the last earlier ticket to change `views/messages.ts`) was dropped too, so M9 runs alongside M6/M7; the orchestrator resolves overlaps on that file at merge.
