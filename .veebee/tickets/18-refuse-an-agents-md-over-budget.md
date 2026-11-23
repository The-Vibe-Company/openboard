---
id: 18
title: Refuse an AGENTS.md over its byte budget
milestone: M0-foundations
package: tools
writes:
  - scripts/ci/agents-guard.ts
  - scripts/ci/agents-guard.test.ts
  - package.json
conformance: []
modes: []
depends_on: [16]
status: done
claimed_by: claude-t18
issue: 18
---

## What the user does
As a contributor, I keep AGENTS.md short and free of issue numbers and dates.

## Done when
- [x] growing `AGENTS.md` past 9,216 bytes makes `bun run lint` exit 1 with the size
- [x] an issue reference like `#12` or a date in `AGENTS.md` makes `bun run lint` exit 1 naming the line

## Out of scope
- Rewriting AGENTS.md content (docs PRs).

## Notes
`docs/codebase.md` 5.1.
