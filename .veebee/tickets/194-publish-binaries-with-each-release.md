---
id: 194
title: Publish binaries with each release
milestone: M7-hosted-deploy
package: tools
writes:
  - .github/workflows/release.yml
  - scripts/release/checksums.ts
  - scripts/release/checksums.test.ts
conformance: []
modes: [local, hosted]
depends_on: [193]
status: draft
claimed_by: null
issue: 355
---

## What the user does
As someone self-hosting OpenBoard, I download `openboard` or `ob` for my machine from the GitHub release and check its SHA-256 before running it.

## Done when
- [ ] `bun test scripts/release/checksums.test.ts` passes: `bun scripts/release/checksums.ts dist` writes `dist/SHA256SUMS` with one line per `openboard-*` and `ob-*` file, in the format `shasum -a 256 -c SHA256SUMS` accepts, and exits 1 with `error: missing_binary: <name>` when one of the eight is absent
- [ ] for a release `v<version>`, `gh release view v<version> --json assets -q '.assets[].name'` lists `openboard-` and `ob-` for `linux-x64`, `linux-arm64`, `darwin-arm64` and `darwin-x64` plus `SHA256SUMS`, and `docker manifest inspect ghcr.io/the-vibe-company/openboard:<version>` lists `linux/amd64` and `linux/arm64`

## Out of scope
- Publishing the SDK and the client-only CLI to npm (M12, 348, 349).
- Signing binaries or notarizing the macOS ones (not planned).

## Notes
- docs/codebase.md 7.1 step 3 (four targets, `ob-<target>` the same bytes as `openboard-<target>`) and 7.4 (binaries built on native runners, attached with SHA-256 sums; multi-arch image to GHCR). `bun run build` (187) and the Dockerfile (188) already exist; this ticket runs them per architecture in `release.yml` and merges the image manifests.
- The release job runs after 193's tag and before the production deploy, so a release never reaches production without its binaries.
- Pin actions by commit, as `.github/workflows/ci.yml` does.

Re-enabled (owner, 2026-11-24: "Ok pour railway pour moi"). Railway is set up: project `openboard` (d2f79d2f-64b8-4c30-b922-3b9502e6ea4e), environment `staging` with a `Postgres` service and an empty `openboard` service at https://openboard-staging.up.railway.app, variables OPENBOARD_DATABASE_URL (reference to Postgres), OPENBOARD_SECRET_KEY, OPENBOARD_PUBLIC_URL, OPENBOARD_SIGNUP=closed already set. GitHub OAuth credentials and any deploy token are set by the owner; never print or commit them.
