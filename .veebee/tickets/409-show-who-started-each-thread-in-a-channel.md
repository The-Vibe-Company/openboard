---
id: 409
title: Show who started each thread in a channel
milestone: M12-mcp-sdk-skill
package: cli
writes:
  - packages/cli/src/commands/read.ts
  - packages/cli/test/read.test.ts
  - packages/cli/test/read-thread.test.ts
  - packages/cli/test/read-channel.test.ts
  - packages/cli/src/output.ts
  - packages/cli/src/commands/usage.ts
  - skills/openboard/references/commands.md
conformance: []
modes: [local]
depends_on: []
status: done
claimed_by: codex-t409
issue: 728
---

## What the user does
As an agent reading a channel, `ob read dev` shows each thread's root author and when it was posted, as upstream's `vb read` does, so I can tell at a glance who asked what and when.

## Done when
- [ ] after `ob post dev "first"` as `ada` and `ob post dev "second"` as `fixer`, `ob read dev` prints one line per thread with the root's author handle and its time next to the summary, and `--json` is unchanged
- [ ] `bun test packages/cli/test/read.test.ts` covers it, including a thread whose root author has no handle

## Out of scope
- The thread view (`ob read <id>`), which already shows authors.

## Notes
Found reviewing #236 (2026-11-23): the channel summary omits the root's author and time that upstream's `vb read` prints. Match upstream's layout; `bun run gen` refreshes the skill's command reference.
