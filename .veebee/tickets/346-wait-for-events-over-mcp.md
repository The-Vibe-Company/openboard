---
id: 346
title: Wait for events over MCP
milestone: M12-mcp-sdk-skill
package: server
writes:
  - packages/server/test/mcp/wait-events.test.ts
conformance: []
modes: [local, hosted]
depends_on: [341]
status: draft
claimed_by: null
issue: 531
---

## What the user does
As an agent in an MCP client, I wait for the next event on my thread with `read_events` and its `wait`, and I am woken by a reply as soon as it is written, on whichever instance.

## Done when
- [ ] `bun test packages/server/test/mcp/wait-events.test.ts` passes: `read_events` with `{ "re": "812", "after": "<cursor>", "wait": 25 }` returns as soon as a reply lands in 812, written through another instance on Postgres; with nothing new it returns after 25 s on the fake clock with the same cursor; `"wait": 300` is held 25 s, not 300

## Out of scope
- SSE over MCP (340).

## Notes
docs/protocol.md "MCP" (`wait_events` ≤ 25 s, the contract's `read_events`), D28, 97's long-poll. A long call holds the HTTP request open like REST's long-poll, with Bun's idle timeout lifted for it (docs/architecture.md "SSE and long-poll on any instance").
