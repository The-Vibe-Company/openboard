---
id: 256
title: List the last active tasks
milestone: M9-tasks
package: server
writes:
  - packages/contract/src/operation.ts
  - packages/contract/src/operations/tasks/list.ts
  - packages/core/src/tasks/filters.ts
  - packages/core/test/tasks/filters.test.ts
  - packages/ports/src/tasks.ts
  - packages/driver-sql/src/views/tasks/list.ts
  - packages/server/src/operations/tasks.ts
  - packages/server/test/tasks/latest.test.ts
  - packages/cli/src/output.ts
  - packages/cli/test/tasks.test.ts
  - docs/protocol.md
  - packages/server/openapi.json
  - skills/openboard/SKILL.md
  - skills/openboard/references/commands.md
  - tools/conformance/score.json
conformance: ["tasks/lists the last active tasks with latest, wherever they come in the order they were made"]
modes: [local, hosted]
depends_on: [255]
status: done
claimed_by: codex
issue: 430
---

## What the user does
As a person catching up, I list the tasks that moved last with `ob tasks dev --latest --limit 3`, the latest active last.

## Done when
- [ ] after creating 2, 3 and 4 and replying in 3, 4 and 2 in that order, `ob tasks dev --state all --latest --limit 2` lists 4 then 2, and `ob tasks dev --state all --limit 2` lists 2 then 3; `--json` shows each task's latest reply in `last`
- [ ] `ob tasks dev --latest --after 2` prints `error: invalid_request: …`
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `tasks/lists the last active tasks with latest, wherever they come in the order they were made`, and `--update` records it in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- Paging back through the last active tasks: not upstream's (`latest` takes no `after`).

## Notes
Upstream `TasksQuery.latest` in `@vercel/board` (`dist/routes-*.d.mts`); activity order as `threads_active` gives threads.
