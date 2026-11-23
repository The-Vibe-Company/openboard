---
id: 12
title: Refuse console output outside the two output files
milestone: M0-foundations
package: tools
writes:
  - .oxlintrc.json
  - scripts/ci/fixtures/oxlint/console/**
conformance: []
modes: []
depends_on: [11]
status: done
claimed_by: codex
issue: 12
---

## What the user does
As a contributor, I print only through the server logger or the CLI output module.

## Done when
- [ ] `console.log` in `packages/server/src/app.ts` or `apps/openboard/src/main.ts` makes `bun run lint` exit 1, while the same call in `packages/server/src/log.ts` or `packages/cli/src/output.ts` passes

## Out of scope
- Log redaction (59).

## Notes
`docs/codebase.md` 3.2 (`console.*` row, scope packages and apps), 3.3 point 2.
