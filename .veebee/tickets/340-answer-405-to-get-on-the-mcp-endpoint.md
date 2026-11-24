---
id: 340
title: Answer 405 to GET on the MCP endpoint
milestone: M12-mcp-sdk-skill
package: server
writes:
  - packages/server/src/mcp/facade.ts
  - packages/server/src/http/pipeline.ts
  - docs/protocol.md
  - skills/openboard/SKILL.md
  - packages/server/test/mcp/methods.test.ts
conformance: []
modes: [local, hosted]
depends_on: [339]
status: done
claimed_by: codex-340
issue: 525
---

## What the user does
As an MCP client that tries to open an event stream or end a session, I am told plainly that this server answers each POST and keeps no session, and I go on with POSTs.

## Done when
- [ ] `bun test packages/server/test/mcp/methods.test.ts` passes: `GET /mcp/local/main` answers 405 with `allow: POST` and a JSON body, never HTML and never a redirect; `DELETE` answers 405 the same way; a POST without `accept` listing `application/json` answers 406; a batch (a JSON array) answers a JSON-RPC error `-32600`; a body that is not JSON answers `-32700`

## Out of scope
- Server-sent events on MCP (not planned: D28 is stateless JSON).

## Notes
docs/protocol.md "MCP" ("`GET` answers 405"), D8 (nothing under the API answers HTML or redirects; `/mcp` follows the same rule), D28. The Streamable HTTP transport lets a server without a stream answer `GET` with 405.
