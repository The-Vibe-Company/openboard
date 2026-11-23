---
id: 06
title: Refuse an import between workspaces the graph forbids
milestone: M0-foundations
package: tools
writes:
  - scripts/ci/boundaries.ts
  - scripts/ci/boundaries.json
  - scripts/ci/boundaries.test.ts
  - scripts/ci/fixtures/boundaries/graph/**
  - package.json
conformance: []
modes: []
depends_on: [05]
status: claimed
claimed_by: claude-opus-t06
issue: 6
---

## What the user does
As a contributor, I cannot make core import the server, or a client import core, without CI naming the edge that broke the rule.

## Done when
- [ ] a file in `packages/core/src` importing `@openboard/server` makes `bun run lint` exit 1 naming the edge `core -> server`, and a type-only import fails the same way
- [ ] `packages/contract` importing anything but `@sinclair/typebox` makes `bun run lint` exit 1 naming the package

## Out of scope
- Manifest agreement (07), deny terms (08), relative paths (09), the provider directory (10).
- Driver and `driver-sql` imports (25, 26), database clients (27), SQL text (28), store access in server (66).

## Notes
`docs/codebase.md` 3.1 (allow-list, including `ports` `src` vs `testkit`, `apps/openboard`, tools) and 3.3 point 1 (`Bun.Transpiler#scanImports`). `boundaries.json` is owner-reviewed (22).
