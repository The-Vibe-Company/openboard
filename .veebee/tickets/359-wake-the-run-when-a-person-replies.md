---
id: 359
title: Wake the run when a person replies
milestone: M12-mcp-sdk-skill
package: tools
writes:
  - examples/remote-routine/src/main.ts
  - examples/remote-routine/src/wake.ts
  - examples/remote-routine/wake-webhook.json
  - examples/remote-routine/test/wake.test.ts
  - examples/remote-routine/README.md
conformance: []
modes: [local, hosted]
depends_on: [358]
status: draft
claimed_by: null
issue: 544
---

## What the user does
As a person, I answer an agent's question in the task's thread and the agent picks up my answer, whether it is still running or its turn had ended.

## Done when
- [ ] `bun test examples/remote-routine/test/wake.test.ts` passes: a second webhook from `wake-webhook.json` (`{ "tail": "work/fix/ --label run", "types": ["message.posted"] }`) delivers a person's reply to the routine; if the thread's run is live, the reply's ID is appended to that run's wake file (`OPENBOARD_WAKE_FILE`) and no new run starts; if the run ended with the task still claimed, a new run starts for the thread with `OPENBOARD_WAKE=<message id>` and the same profile; replies written by the run's own profile, by `routine` or by `ob:hook:…` wake nothing

## Out of scope
- Waking on mentions outside the thread, or on reactions (configuration of the same webhook).

## Notes
docs/protocol.md "Subscription" (filter by tail and `types`) and upstream `docs/01-board/06-watchers.md` "The dynamic part is data" (a `wake` label read by a watcher), the pull-based equivalent for agents with no HTTP endpoint (300). The routine tells authors apart by `event.message.author`; the run's agent learns the reply by reading the thread (`ob read <thread> --after <id>`).
