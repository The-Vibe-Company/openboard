---
id: 348
title: Publish the SDK to npm
milestone: M12-mcp-sdk-skill
package: sdk
writes:
  - packages/sdk/package.json
  - packages/sdk/scripts/build.ts
  - packages/sdk/test/package.test.ts
  - .github/workflows/release.yml
  - scripts/release/npm.ts
  - scripts/release/npm.test.ts
conformance: []
modes: [local, hosted]
depends_on: [194, 347]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a developer outside this repository, I run `npm install @the-vibe-company/openboard` and import `openboard` and `createClient` in Node 22, Bun or a browser bundle.

## Done when
- [ ] `bun test packages/sdk/test/package.test.ts` passes: `bun packages/sdk/scripts/build.ts` writes `dist/index.js` (ESM) and `dist/index.d.ts` with the contract inlined (no `@openboard/*` import left), `npm pack --dry-run --json` in `packages/sdk` lists only `dist/`, `README.md`, `LICENSE`, `package.json`, and `node --input-type=module -e "import('./dist/index.js').then(m => console.log(typeof m.openboard))"` prints `function`
- [ ] for a release `v<version>`, `npm view @the-vibe-company/openboard@<version> version` prints `<version>` and `npm view @the-vibe-company/openboard@<version> dist.attestations` shows a provenance attestation; `bun test scripts/release/npm.test.ts` passes: the publish step refuses a version that differs from the release tag with `error: version_mismatch: …`

## Out of scope
- The CLI package (349).

## Notes
docs/codebase.md 2.1 (`packages/sdk` published, small and runtime-agnostic: Bun, Node 22, browser) and 4.2 (contract inlined in the bundle), docs/project.md M12. Publish from `.github/workflows/release.yml` (193, 194) after the binaries, with npm's trusted publishing (OIDC from GitHub Actions) so no npm token is stored; if the owner prefers a token, it lives in the GitHub environment `production`, never in a file. Pin actions by commit. The package's `dependencies` drop `@openboard/contract` once it is inlined, so `scripts/ci/boundaries.ts`'s manifest check must still agree with the imports.
