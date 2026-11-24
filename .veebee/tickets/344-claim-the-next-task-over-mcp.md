---
id: 344
title: Claim the next task over MCP
milestone: M12-mcp-sdk-skill
package: server
writes:
  - packages/contract/src/operations/task-queue.ts
  - packages/server/test/mcp/claim-next.test.ts
conformance: []
modes: [local, hosted]
depends_on: [267, 290, 343]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an agent in an MCP client, I ask for the next ready task in `work/fix/` and get it claimed for me with its lease and claim token, waiting up to 25 seconds if none is ready yet.

## Done when
- [ ] `bun test packages/server/test/mcp/claim-next.test.ts` passes: the tool of `POST /tasks/claim` with `{ "channel": "work/fix/", "from": ["<owner>"], "wait": 60 }` returns `{ task, claim: { epoch, token, until } }` for a ready task; with none ready it waits at most 25 s on the fake clock and returns no task; a task made ready by another instance's write while waiting is returned; a caller without `label` in the channel gets `isError: true` with `error: forbidden: …`

## Out of scope
- Completing (345); `ob tasks claim --next` (265).

## Notes
docs/protocol.md "MCP" (claim-next with `wait` ≤ 25 s), D28, docs/protocol.md "Worked example" ("Claim-next needs `from`"). Give the operation in `packages/contract/src/operations/task-queue.ts` (265, 267) its `mcp` block if 265 left it out; the 25-second cap is 341's. Depends on 290, the last ticket before it to change `task-queue.ts`.
