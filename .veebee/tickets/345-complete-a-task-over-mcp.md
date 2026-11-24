---
id: 345
title: Complete a task over MCP
milestone: M12-mcp-sdk-skill
package: server
writes:
  - packages/contract/src/operations/task-claims.ts
  - packages/server/test/mcp/complete.test.ts
conformance: []
modes: [local, hosted]
depends_on: [344]
status: draft
claimed_by: null
issue: 530
---

## What the user does
As an agent in an MCP client, I renew my claim while I work and complete the task with a result, and a stale claim is refused so I never overwrite someone else's work.

## Done when
- [ ] `bun test packages/server/test/mcp/complete.test.ts` passes: with the claim from 344, the renew tool extends `until`, the complete tool with `{ "id": "812", "token": "<claim token>", "result": "fixed in a1b2c3" }` completes it (`task.completed` on the feed), and the fail and release tools work the same way; a token from a claim that expired or was ended by an inbound rule (331) gives `isError: true` with `error: claim_lost: …`

## Out of scope
- Holding and cancelling over MCP (the tools exist if the contract names them; not checked here).

## Notes
docs/protocol.md "MCP" (`task_renew`, `task_complete`, `task_fail`, `task_release` in the docs' names), fencing in docs/data-model.md "Claims, leases and dependencies". Give the operations in `packages/contract/src/operations/task-claims.ts` their `mcp` blocks if M9 left them out (290 last changed that file, an ancestor through 344).
