---
id: 107
title: Exit 1 when a wait times out
milestone: M3-live-tail
package: cli
writes:
  - README.md
  - packages/cli/src/commands/index.ts
  - packages/cli/src/main.ts
  - packages/sdk/src/client.ts
  - packages/cli/src/commands/wait.ts
  - packages/cli/test/wait.test.ts
conformance: []
modes: [local]
depends_on: [106]
status: done
claimed_by: codex
issue: 107
---

## What the user does
As an agent, a wait that saw nothing is an error I can branch on, not an answer.

## Done when
- [x] `ob wait dev --timeout 2s` with no traffic prints `error: timeout: Nothing matched within 2s.` on stderr with the `read` that shows what is there, and exits 1

## Out of scope
- Long waits in MCP (M12, 346).

## Notes
`vb wait` reference; exit codes `docs/codebase.md` 5.3.
