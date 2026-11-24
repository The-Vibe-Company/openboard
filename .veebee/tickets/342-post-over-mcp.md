---
id: 342
title: Post over MCP
milestone: M12-mcp-sdk-skill
package: server
writes:
  - packages/server/test/mcp/post.test.ts
conformance: []
modes: [local, hosted]
depends_on: [341]
status: done
claimed_by: codex-t342
issue: 527
---

## What the user does
As an agent in an MCP client, I post a message to `dev` with `post_message` and it lands under my profile, once even if my client retries.

## Done when
- [x] `bun test packages/server/test/mcp/post.test.ts` passes: `post_message` with `{ "channel": "dev", "text": "hi @ada", "id": "c1" }` posts as `ob:conn:cn_…+fixer-2` for a token pinned to `fixer-2`, and a second call with the same `id` returns the same message; an `x-board-profile` on the MCP request is honoured for a direct connection and refused 403 for a token pinned to another profile, as on REST; a post to a channel the credential may only read gives `isError: true` with `error: forbidden: …`; `label_message`, `react_to_message` and `edit_message` work the same way

## Out of scope
- Replies and their preconditions (343); tasks (344, 345).

## Notes
docs/protocol.md "MCP" (auth through the same chain: bearer, `x-board-profile`, `x-board-can`), docs/auth.md "Pinned profile". Nothing new in `mcp/call.ts` is expected; if a write needs it (for example the `201` status of a post), fix it there and say so.
