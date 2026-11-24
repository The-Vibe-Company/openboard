---
id: 407
title: Answer invalid_channel on every channel input
milestone: M12-mcp-sdk-skill
package: core
writes:
  - packages/core/src/channels/path.ts
  - packages/server/src/http/errors.ts
  - packages/server/src/http/pipeline.ts
  - packages/server/test/channel-input.test.ts
  - packages/cli/test/channel-input.test.ts
  - docs/protocol.md
  - packages/contract/src/channel-input.ts
  - packages/contract/src/entities/messages.ts
  - packages/contract/src/errors.ts
  - packages/contract/src/index.ts
  - packages/contract/src/operations/thread-filters.ts
  - packages/core/src/access/grants.ts
  - packages/core/src/events/tail.ts
  - packages/core/src/index.ts
  - packages/core/src/watchers/register.ts
  - skills/openboard/SKILL.md
conformance: []
modes: [local, hosted]
depends_on: []
status: done
claimed_by: Codex
issue: 726
---

## What the user does
As an agent, any command that takes a channel and gets a malformed one (`ob read Dev Ops`, `ob channels create /dev`, `ob tasks dev..x`) answers the same `invalid_channel` reason with a corrected `next`, as `ob post` already does.

## Done when
- [ ] `bun test packages/server/test/channel-input.test.ts` passes: every operation whose input has a channel path or pattern (read, threads, events filters, channels create, tasks list and create, grants patterns, watcher tails) answers 400 with reason `invalid_channel` and a `next` naming the corrected path when one exists, as `POST /messages` does today
- [ ] `bun test packages/cli/test/channel-input.test.ts` shows `ob read "Dev Ops"` printing the same `error: invalid_request: …` line with the corrected command as `ob post "Dev Ops" hi`

## Out of scope
- Changing what a valid channel path is.

## Notes
From the review of #217 (ticket 41): only `post` gives the reason and the corrected `next` (`invalidPostChannel` in `packages/server/src/http/errors.ts`). Generalise it from the contract: an input field that is a `ChannelPath` or pattern gets the same treatment, so new operations inherit it.
