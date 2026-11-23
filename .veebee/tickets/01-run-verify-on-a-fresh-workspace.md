---
id: 01
title: Run verify on a fresh workspace
milestone: M0-foundations
package: tools
writes:
  - package.json
  - bun.lock
  - tsconfig.json
  - biome.json
  - .oxlintrc.json
  - .gitignore
  - packages/*/package.json
  - packages/*/tsconfig.json
  - packages/*/src/index.ts
  - apps/*/package.json
  - apps/*/tsconfig.json
  - tools/*/package.json
  - tools/*/tsconfig.json
conformance: []
modes: []
depends_on: []
status: review
claimed_by: claude-0ad7d5d1
issue: 1
---

## What the user does
As a contributor, I clone the repo, install once, and run one command that tells me whether my change is fit to push.

## Done when
- [ ] `bun install && bun run verify` exits 0 and prints its format, lint, typecheck and test steps over the empty workspaces `contract`, `core`, `ports`, `driver-sql`, `driver-sqlite`, `driver-postgres`, `server`, `sdk`, `cli`, `apps/openboard`, `apps/web`, `tools/conformance`, `tools/bench`
- [ ] a file with a formatting error makes `bun run verify` exit 1 naming the file, and `bun run format` fixes it so `bun run verify` passes again

## Out of scope
- Import-graph and package rules (06 to 10, 25 to 28), in-file lint rules (11 to 15), sizes (16, 17), migrations (29 to 31).
- The CI workflow (20, 35), conformance (02), bench (05), `verify:pg` (34).
- `gen` and `gen:check`: they arrive with the first operation (63, 64).

## Notes
Layout: `docs/codebase.md` section 2 (workspaces `packages/*`, `apps/*`, `tools/*`, `examples/*`); TypeScript and Biome: 5.7. The contract's schema library is TypeBox (`docs/decisions.md` D20; `docs/codebase.md` 3.1).
