---
id: 13
title: Refuse environment reads outside the config modules
milestone: M0-foundations
package: tools
writes:
  - .oxlintrc.json
  - docs/codebase.md
  - scripts/ci/fixtures/oxlint/env/**
conformance: []
modes: []
depends_on: [12]
status: done
claimed_by: claude-62ab5e42
issue: 13
---

## What the user does
As a contributor, I read the environment only in the two config modules.

## Done when
- [x] `process.env.PORT` or `Bun.env.PORT` in `packages/server/src/app.ts` makes `bun run lint` exit 1, while `apps/openboard/src/config.ts` and `packages/cli/src/config.ts` pass

## Out of scope
- The typed config itself (36, 61).

## Notes
`docs/codebase.md` 3.2 (env row) and 5.5. 3.3 does not name the mechanism for this rule; oxlint is the natural one: record the choice in the PR.
