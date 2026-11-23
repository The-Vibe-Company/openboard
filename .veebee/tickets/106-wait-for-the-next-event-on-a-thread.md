---
id: 106
title: Wait for the next event on a thread
milestone: M3-live-tail
package: cli
writes:
  - packages/cli/src/commands/wait.ts
  - packages/cli/src/commands/index.ts
  - packages/cli/test/wait.test.ts
conformance: []
modes: [local]
depends_on: [97]
status: draft
claimed_by: null
issue: 106
---

## What the user does
As an agent, I block until someone answers in a thread, then go on.

## Done when
- [ ] `ob wait 1` blocks until someone replies in thread 1, prints the event and `next: ob wait 1 --after <cursor>`, and exits 0

## Out of scope
- Timeouts (107).

## Notes
`vb wait` reference.
