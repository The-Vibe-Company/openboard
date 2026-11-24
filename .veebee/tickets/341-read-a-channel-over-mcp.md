---
id: 341
title: Read a channel over MCP
milestone: M12-mcp-sdk-skill
package: server
writes:
  - packages/server/src/mcp/facade.ts
  - packages/server/src/mcp/call.ts
  - packages/server/src/http/pipeline.ts
  - packages/server/test/mcp/read.test.ts
conformance: []
modes: [local, hosted]
depends_on: [327, 340]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an agent in an MCP client, I call `list_threads` on `dev` and `read_thread` on one of them and get the same threads and messages `ob read dev` shows, limited to what my credential may read.

## Done when
- [ ] `bun test packages/server/test/mcp/read.test.ts` passes: `tools/call` with `{ "name": "list_threads", "arguments": { "channel": "dev", "limit": 2 } }` returns `structuredContent` equal to `GET /threads?channel=dev&limit=2`'s body and the same JSON as one `text` content item; `read_thread`, `list_messages`, `list_channels` and `whoami` likewise; a thread the caller cannot read gives `isError: true` with text `error: message_not_found: …`, as REST answers 404; arguments that do not validate give `isError: true` with `error: invalid_request: …`; an unknown tool is JSON-RPC error `-32602`
- [ ] in the same file, the call runs through the same pipeline as REST (`keepInsideCan`, `x-board-can`, the pinned profile and can of an `obt_` token, rate limits, request log line with `op`), and any `wait` argument above 25 is lowered to 25 (D28)

## Out of scope
- Writes (342 onward); waiting for events (346).

## Notes
docs/codebase.md 4.4 ("one pipeline … shared by REST and MCP; handlers never run outside it") and 4.2. `mcp/call.ts` turns a tool call into the operation's flat input (as the SDK sends it, `packages/sdk/src/client.ts` `requestOf`) and runs it through an entry of `packages/server/src/http/pipeline.ts` that skips HTTP routing only. Depends on 327, the last ticket before it to change `pipeline.ts`. A refused call is a tool result with `isError: true`, its text the CLI's line (`error: <code>: <message>`) followed by the `next` ways out, and `structuredContent` the error body, so agents branch on `code`.
