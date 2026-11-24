---
id: 349
title: Publish the client-only CLI to npm
milestone: M12-mcp-sdk-skill
package: cli
writes:
  - packages/cli/package.json
  - packages/cli/bin/ob.js
  - packages/cli/scripts/build.ts
  - packages/cli/test/package.test.ts
  - packages/cli/src/commands/schemas/create.ts
  - packages/cli/src/config.ts
  - packages/cli/src/main.ts
  - skills/openboard/SKILL.md
  - .github/workflows/release.yml
  - scripts/ci/boundaries/imports.ts
  - scripts/ci/boundaries.test.ts
  - scripts/release/npm.ts
  - scripts/release/npm.test.ts
conformance: []
modes: [local, hosted]
depends_on: [348]
status: done
claimed_by: codex
issue: 534
---

## What the user does
As an agent in a sandbox with Node and no OpenBoard binary, I run `npx -y @the-vibe-company/openboard-cli whoami` with `BOARD_URL` and `BOARD_TOKEN` set and use every `ob` client command, never downloading server code.

## Done when
- [ ] `bun test packages/cli/test/package.test.ts` passes: the build writes `dist/main.js` that runs under `node` 22 with no Bun API, the package's `bin` maps `ob` to `bin/ob.js`, `npm pack --dry-run --json` lists no server, driver or web file, and `node bin/ob.js serve` prints `error: invalid_request: ob serve needs the openboard binary` and exits 2
- [ ] for a release `v<version>`, in an empty directory with `BOARD_URL` and `BOARD_TOKEN` of a staging connection, `npx -y @the-vibe-company/openboard-cli@<version> whoami` prints the connection's actor, and `npx -y @the-vibe-company/openboard-cli@<version> connect "$BOARD_URL" --as fixer-2 < secret-file` then `… post dev hi` posts as `fixer-2`

## Out of scope
- The `openboard` server binary and `ob serve` (published as binaries, 194).

## Notes
docs/codebase.md 2.1 (`packages/cli` published to npm as a Node-compatible client; agents use it with `npx` and never download server code), D42 (`ob` is the CLI's name; secrets never in argv), docs/auth.md "One-line UX per surface". The CLI depends on the published SDK (348) by its package name. Depends on 348, which also changes `release.yml` and `scripts/release/npm.ts`.
