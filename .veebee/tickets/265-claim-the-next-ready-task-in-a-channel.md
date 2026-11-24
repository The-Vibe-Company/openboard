---
id: 265
title: Claim the next ready task in a channel
milestone: M9-tasks
package: server
writes:
  - packages/contract/src/operations/tasks/queue.ts
  - packages/contract/src/operations/index.ts
  - packages/core/src/tasks/next.ts
  - packages/core/test/tasks/next.test.ts
  - packages/ports/src/tasks.ts
  - packages/ports/testkit/store/tasks.test-suite.ts
  - packages/ports/testkit/isolation.test-suite.ts
  - packages/driver-sql/src/views/tasks/tasks.ts
  - packages/driver-sql/src/statements.ts
  - packages/server/src/operations/tasks/queue.ts
  - packages/server/src/operations/index.ts
  - packages/server/test/tasks/claim-next.test.ts
  - packages/server/test/isolation/cases.ts
  - packages/cli/src/commands/tasks/claim.ts
  - packages/cli/src/commands/derived.ts
  - packages/cli/src/commands/usage.ts
  - packages/cli/src/claims.ts
  - packages/cli/test/tasks.test.ts
  - packages/contract/src/index.ts
  - docs/protocol.md
  - packages/server/openapi.json
  - skills/openboard/references/commands.md
conformance: []
modes: [local, hosted]
depends_on: [264]
status: done
claimed_by: codex
issue: 439
---

## What the user does
As an agent, I take whatever is next in a channel with `ob tasks claim --next --channel dev`, without picking an ID.

## Done when
- [x] with ready tasks 2 then 3 in `dev`, `ob tasks claim --next --channel dev` claims 2, run again claims 3, and a third time prints `no ready task in dev` (`--json` `{ "task": null }`) and exits 0
- [x] `ob tasks claim --next --channel dev/` takes the oldest ready task in `dev` or under it; a task assigned to the caller's actor (264) comes before the oldest unassigned one its principal owns, and a task another principal owns is not taken

## Out of scope
- Labels (266), `wait` (267), other owners with `from` (268).

## Notes
- Upstream `POST /tasks/claim { channel, label?, from?, lease?, wait? }` → `{ task, claim }` or `{ task: null }`; docs/data-model.md "Claim next". `access: { permission: "label", channel: "fromInput" }`, a subtree needing it throughout (D53). Index `tasks_ready`.
- AGENTS.md and docs/project.md write `ob tasks claim --next --channel <channel>`; docs/protocol.md's worked example writes `ob tasks claim --channel work/fix/ …`. Both work: `--channel` without an ID claims the next, and `--next` says so. Upstream's `vb tasks claim --ready <channel>` stays upstream's.
