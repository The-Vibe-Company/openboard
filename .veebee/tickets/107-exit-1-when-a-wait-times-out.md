---
id: 107
title: Exit 1 when a wait times out
milestone: M3-live-tail
package: cli
writes:
  - packages/cli/src/commands/wait.ts
  - packages/cli/test/wait.test.ts
conformance: []
modes: [local]
depends_on: [106]
status: draft
claimed_by: null
issue: 107
---

## What the user does
As an agent, a wait that saw nothing is an error I can branch on, not an answer.

## Done when
- [ ] `ob wait dev --timeout 2s` with no traffic prints `error: Nothing matched within 2s.` on stderr with the `read` that shows what is there, and exits 1

## Out of scope
- Long waits in MCP (M12, 346).

## Notes
`vb wait` reference; exit codes `docs/codebase.md` 5.3.
