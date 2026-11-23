---
id: 08
title: Refuse an integration name in packages or apps
milestone: M0-foundations
package: tools
writes:
  - scripts/ci/boundaries.ts
  - scripts/ci/boundaries.json
  - scripts/ci/fixtures/boundaries/deny/**
conformance: []
modes: []
depends_on: [07]
status: done
claimed_by: codex-t08
issue: 8
---

## What the user does
As a contributor, I cannot put a vendor we integrate with into packages or apps, comments included.

## Done when
- [x] a comment mentioning `Slack` in `packages/core/src/x.ts` makes `bun run lint` exit 1 naming the file, the line and the term
- [x] the same word under `examples/` passes

## Out of scope
- The GitHub exception for sign-in (10).
- Integrations themselves: `examples/` recipes from M11 on.

## Notes
Deny terms and scope: `docs/codebase.md` 3.2 last row.
