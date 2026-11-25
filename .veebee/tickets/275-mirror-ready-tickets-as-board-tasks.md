---
id: 275
title: Mirror ready tickets as board tasks
milestone: M9-tasks
package: tools
writes:
  - scripts/tickets/sync-board.ts
  - scripts/tickets/lib.ts
  - scripts/tickets/test/sync-board.test.ts
  - docs/project.md
conformance: []
modes: [local, hosted]
depends_on: [267]
status: claimed
claimed_by: claude-code
issue: 450
---

## What the user does
As the owner, each `ready` ticket file is a task in `openboard/tickets` that agents claim with `ob tasks claim --next --channel openboard/tickets`.

## Done when
- [ ] `bun scripts/tickets/sync-board.ts --url <BOARD_URL> < secret-file` creates one task per `status: ready` ticket in `openboard/tickets`, text `<id> <title>` with label `ticket=<id>`, needing the tasks of its `depends_on` tickets that are not `done`; a second run creates nothing (one client ID per ticket path) and prints what it skipped
- [ ] `bun test scripts/tickets/test/sync-board.test.ts` passes against an in-process app, no network: a ticket whose dependencies have no open task is `ready`, one whose dependency's task is open is `waiting`, and the secret is never printed

## Out of scope
- Completing a ticket's task when its PR merges: the agent does it (docs/project.md 6, phase B).

## Notes
docs/project.md 6, phase B, and AGENTS.md "Pick a ticket" step 1; the secret arrives on stdin (D42); the script uses the SDK as any agent would.
