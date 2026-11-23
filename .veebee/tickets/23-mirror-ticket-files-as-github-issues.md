---
id: 23
title: Mirror ticket files as GitHub issues
milestone: M0-foundations
package: tools
writes:
  - scripts/tickets/sync-issues.ts
  - scripts/tickets/lib.ts
  - scripts/tickets/test/**
conformance: []
modes: []
depends_on: [01]
status: done
claimed_by: codex
issue: 23
---

## What the user does
As a contributor, I run one script and every ticket file has a GitHub issue that PRs can close.

## Done when
- [ ] `bun scripts/tickets/sync-issues.ts` creates one issue per ticket in `.veebee/tickets/` with labels `pkg:<package>`, the milestone label, the state label and the GitHub milestone, and writes the issue number into the file's `issue:`
- [ ] running it a second time creates no issue and closes none

## Out of scope
- The claim overlap check (24).
- Board tasks for tickets (`scripts/tickets/sync-board.ts`): 275.

## Notes
`docs/project.md` 2.3 and section 4 (labels, including `isolation`).
