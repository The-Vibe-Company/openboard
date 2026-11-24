---
id: 369
title: Start a task with a file
milestone: M13-data-files-schedules
package: server
writes:
  - packages/core/src/tasks/create.ts
  - packages/core/test/tasks/create.test.ts
  - packages/server/src/operations/tasks.ts
  - packages/server/test/attachments/task.test.ts
  - packages/cli/src/commands/tasks.ts
  - packages/cli/test/tasks.test.ts
conformance: ["attachments/starts a task with a file, which its root carries"]
modes: [local, hosted]
depends_on: [238, 268, 291, 367]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a person handing work to an agent, I start a task with the failing log attached, `ob tasks create dev "fix the flaky build" --attach build.log`, and the agent finds the file on the task's root.

## Done when
- [ ] `ob tasks create dev "fix the flaky build" --attach build.log` prints the task; `ob read <id> --json` shows the root with `task.state: "ready"` and `attachments` holding `build.log`, and `ob download` gives its bytes back
- [ ] `bun test packages/server/test/attachments/task.test.ts` passes on SQLite and Postgres: `POST /tasks` and `POST /tasks/batch` carry `attachments` on each new root (at most 10 each), an unknown ID answers as a post's does and makes no task (none of the batch), and `POST /tasks` with `re` refuses `attachments` as upstream does
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` pass `attachments/starts a task with a file, which its root carries`, recorded with `--update` under `local` and `hosted`

## Out of scope
- Uploading (367); files on a schedule (373).

## Notes
- Upstream `POST /tasks` and `/tasks/batch` take `attachments` (`docs/04-reference/03-http.md` "Routes"). The task's root is posted through the same path as a post, so most of the work is passing the IDs through `packages/core/src/tasks/create.ts` and marking them attached in the same write (367's fold). `ob tasks create … --attach` reuses 367's upload helper in `packages/cli/src/commands/attach.ts` from the task command's flags.
- Depends on 291 and 268, the last tickets before it to change `packages/server/src/operations/tasks.ts` and `packages/cli/src/commands/tasks.ts`.
