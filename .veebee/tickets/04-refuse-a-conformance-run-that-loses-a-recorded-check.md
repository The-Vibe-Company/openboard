---
id: 04
title: Refuse a conformance run that loses a recorded check
milestone: M0-foundations
package: tools
writes:
  - tools/conformance/src/score.ts
  - tools/conformance/test/score.test.ts
conformance: []
modes: [local, hosted]
depends_on: [02]
status: ready
claimed_by: null
issue: 4
---

## What the user does
As a contributor, I find out at once when my change breaks a conformance check that used to pass, in either mode.

## Done when
- [ ] adding a check name in `group/name` form under `local` in `tools/conformance/score.json` that does not pass makes `bun run conformance` exit 1 and print that name as lost
- [ ] the same name under `hosted` makes `bun run conformance --driver postgres --instances 2` exit 1, while `bun run conformance` (local) still passes

## Out of scope
- `--update` adding new passes (54).
- `expectedSkips` for the checks that can never pass here (access and sync milestones).
- `scripts/ci/score.ts` refusing a hosted list shorter than the local one: it applies from M5 (171).

## Notes
`docs/codebase.md` 6.3 step 4: entries are only ever added by `--update`; removing one needs the owner's decision.
