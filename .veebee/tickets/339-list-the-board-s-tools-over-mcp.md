---
id: 339
title: List the board's tools over MCP
milestone: M12-mcp-sdk-skill
package: server
writes:
  - packages/server/src/mcp/facade.ts
  - packages/server/src/mcp/tools.ts
  - packages/server/src/http/router.ts
  - packages/server/src/http/scope.ts
  - packages/server/test/mcp/tools.test.ts
  - docs/protocol.md
conformance: []
modes: [local, hosted]
depends_on: [209, 282, 334]
status: draft
claimed_by: null
issue: 524
---

## What the user does
As an agent in an MCP client configured with `{ "url": "<origin>/mcp/acme/main", "headers": { "authorization": "Bearer obt_…" } }`, I connect and see the board's tools with their input schemas.

## Done when
- [ ] with `agent.headers` (mode 0600) holding the `authorization` line of a claimed token, `curl -s -X POST "$ORIGIN/mcp/local/main" -H @agent.headers -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'` answers a JSON (not SSE) result with `serverInfo.name` `openboard` and `capabilities.tools`, and the same call with `"method":"tools/list"` lists one tool per contract operation with an `mcp` block (`whoami`, `list_channels`, `list_threads`, `read_thread`, `post_message`, …), each with `inputSchema` from the operation's input and `annotations` from its `effects`
- [ ] `bun test packages/server/test/mcp/tools.test.ts` passes: the tool list equals the contract's `mcp` blocks (a test fails if an operation's tool is missing or extra); no credential answers HTTP 401 with upstream's error body; a credential bound to another board answers 401 and a person outside the organization 404, as on `/api`; an unknown JSON-RPC method answers error `-32601`; `/mcp/<org>/<board>` resolves like `/api/<org>/<board>`, with `/mcp` alone as the local alias

## Out of scope
- `GET` and `DELETE` on the endpoint (340); calling a tool (341 onward); OAuth for MCP clients (Q5).

## Notes
- docs/protocol.md "MCP" (Streamable HTTP, stateless JSON responses, same auth chain with `x-board-profile` and `x-board-can`), D28, docs/codebase.md 4.2 (MCP: one tool per `mcp` block; schema from `input`; annotations from `effects`; same pipeline as REST) and 5.2 (tool names are the `snake_case` of the operation). docs/protocol.md's tool list (`post`, `reply`, `read_channel`, `task_claim_next`, …) predates the contract's names: replace it with the contract's (`post_message`, `read_thread`, `list_messages`, …) and say that a reply is `post_message` with `re`.
- Stateless: no session ID header, no server-initiated messages; each POST carries one JSON-RPC request (or a notification, answered 202). `annotations`: `readOnlyHint` from `effects.readOnly`, `idempotentHint` from `effects.idempotent`, `destructiveHint` for deletes and revokes.
- The tenant resolver (`packages/server/src/http/scope.ts`) already parses `/mcp/<org>/<board>` in docs/architecture.md; check it does in code. Depends on 209 and 282, the last tickets before it to change `packages/server/src/http/scope.ts` and docs/protocol.md, and on 334, which changes docs/protocol.md in M11.

Orchestrator note: the dependency on 215 (serving production) was dropped: it ordered milestones, it is not a technical need, and 215 waits on the owner's production secrets.
