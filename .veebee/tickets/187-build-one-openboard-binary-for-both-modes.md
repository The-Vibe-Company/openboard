---
id: 187
title: Build one openboard binary for both modes
milestone: M6-high-availability
package: tools
writes:
  - scripts/build/index.ts
  - scripts/build/build.test.ts
  - package.json
  - .gitignore
conformance: []
modes: [local, hosted]
depends_on: [186]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an operator, I download one executable that runs a local board on SQLite or a hosted instance on Postgres, depending on its environment.

## Done when
- [ ] `bun run build` writes `dist/openboard-<target>` and an identical `dist/ob-<target>` for `bun-linux-x64`, `bun-linux-arm64`, `bun-darwin-arm64` and `bun-darwin-x64`
- [ ] the binary for this machine, run as `./dist/ob-<target> serve`, serves the local board (`./dist/ob-<target> post dev hi`, then `./dist/ob-<target> read dev` shows it), and run as `OPENBOARD_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard ./dist/openboard-<target> serve` migrates that database and `curl http://127.0.0.1:8787/api/acme/main` answers discovery

## Out of scope
- Embedding the web front (M8, 216).
- The image (188); publishing binaries with a release (M7, 194).
- Building in the required check: `Verify` never builds binaries (docs/codebase.md 6.7).

## Notes
- docs/codebase.md 7.1 steps 2 and 3: `bun build --compile --minify apps/openboard/src/main.ts`, both drivers in every binary, `OPENBOARD_DATABASE_URL` selecting one at startup; the name only changes the default help. Step 1 (`vite build` of `apps/web`) waits for the front.
- `scripts/build/build.test.ts` builds for the host target only and runs the binary once; it is not part of `bun run test` if it takes more than a second (AGENTS.md "Tests"): say in the PR where it runs.
- Ignore `dist/` in `.gitignore`.
