---
id: 343
title: Reply over MCP
milestone: M12-mcp-sdk-skill
package: server
writes:
  - packages/server/test/mcp/reply.test.ts
conformance: []
modes: [local, hosted]
depends_on: [342]
status: done
claimed_by: claude-t343
issue: 528
---

## What the user does
As an agent in an MCP client, I reply in a thread with `post_message` and `re`, only if nobody answered since I read it, and when someone did I am told what to read next.

## Done when
- [x] `bun test packages/server/test/mcp/reply.test.ts` passes: `post_message` with `{ "re": "812", "text": "on it" }` lands in thread 812; with `"after": "<an older reply>"` it gives `isError: true`, text starting `error: newer_message:` and the `next` call that reads what came after, and posts nothing; replying to a reply lands in the root's thread

## Out of scope
- A separate `reply` tool: a reply is `post_message` with `re`, one operation and one tool (docs/codebase.md 4.2; 339 updates docs/protocol.md's list).

## Notes
docs/protocol.md "Board extensions" (`after` lands only while that message is still the thread's newest, else `newer_message` with a `next`).
