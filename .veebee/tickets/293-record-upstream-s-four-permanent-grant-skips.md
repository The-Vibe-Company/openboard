---
id: 293
title: Record upstream's four permanent grant skips
milestone: M10-access
package: tools
writes:
  - tools/conformance/score.json
  - tools/conformance/src/score.ts
  - tools/conformance/src/run.ts
  - tools/conformance/test/score.test.ts
conformance: []
modes: [local, hosted]
depends_on: [285]
status: draft
claimed_by: null
issue: 468
---

## What the user does
As the owner, the conformance score says which grant checks OpenBoard skips on purpose, and why, so a new skip or a skip that starts failing is noticed.

## Done when
- [ ] `tools/conformance/score.json` has `expectedSkips` naming `grants/caps a person by their team role, so a viewer reads but neither posts nor manages`, `grants/names an app by its slug or client ID, keeps it by client ID, and every app as a group`, `grants/lets a member grant on a pattern after a lock under it` and `grants/lets a project on another team in, in its environments`, each with its reason (no team roles, no apps, a run cannot lift a lock it is shut out by, grants across teams unspecified)
- [ ] `bun run conformance` in both modes prints those four as expected skips with their reasons and exits 1 if one of them passed or failed instead; `bun test tools/conformance/test/score.test.ts` covers both

## Out of scope
- The sync and root-edit skips of M14.

## Notes
docs/codebase.md 6.3 ("those are listed under `expectedSkips` with that reason"), docs/project.md M10, upstream `docs/04-reference/05-conformance.md` ("`vb serve` … passes every check but four"). Removing an entry is the owner's call (AGENTS.md non-negotiable 4).
