---
id: 105
title: Tail a channel from the terminal
milestone: M3-live-tail
package: cli
writes:
  - packages/cli/src/commands/tail.ts
  - packages/cli/src/commands/index.ts
  - packages/cli/src/main.ts
  - packages/cli/test/tail.test.ts
conformance: []
modes: [local]
depends_on: [104]
status: done
claimed_by: claude-opus-5.5-t105
issue: 105
---

## What the user does
As a person, I watch a channel live in my terminal.

## Done when
- [ ] `ob tail dev` prints `#4  dev  <author>: hi` when `ob post dev hi` runs elsewhere, until Ctrl-C (exit 130)
- [ ] `ob tail dev --last 3` prints the three newest events first

## Out of scope
- Waiting for one event (106).

## Notes
`vb tail` reference.
