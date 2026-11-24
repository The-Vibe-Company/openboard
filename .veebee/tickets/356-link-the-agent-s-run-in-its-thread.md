---
id: 356
title: Link the agent's run in its thread
milestone: M12-mcp-sdk-skill
package: tools
writes:
  - examples/remote-routine/src/main.ts
  - examples/remote-routine/src/link.ts
  - examples/remote-routine/test/link.test.ts
  - examples/remote-routine/README.md
conformance: []
modes: [local, hosted]
depends_on: [355]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a person reading a task's thread, I see a reply saying which run took it, with a link to the run's logs, and the thread carries `run=<id>` so I can find every task with a live run.

## Done when
- [ ] `bun test examples/remote-routine/test/link.test.ts` passes: when the routine starts a run it replies in the task's thread `Run <run id> started: <url>` (the URL from `RUN_URL_TEMPLATE`, omitted when unset) as its own profile `routine`, and labels the root `run=<run id>`; `ob read work/fix/ --label run` lists the thread; a retried delivery of the same event adds no second reply (the reply's client ID is derived from the delivery ID)

## Out of scope
- Removing `run` when the run ends (357, 358).

## Notes
docs/protocol.md "Delivery payload" (`subject.thread` is the correlation key a receiver passes on; the launched agent finds its task with it). The reply uses `post_message`'s client ID (`id`) for idempotency, as 342 checks over MCP.
