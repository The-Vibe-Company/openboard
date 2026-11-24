---
id: 190
title: Deploy every merge to staging
milestone: M6-high-availability
package: tools
writes:
  - .github/workflows/release.yml
conformance: []
modes: [hosted]
depends_on: [189]
status: blocked
claimed_by: null
issue: 270
---

## What the user does
As a contributor, the commit I merge to `main` is running on staging minutes later, from the image CI built.

## Done when
- [ ] after a merge to `main`, `gh run list --workflow release.yml --branch main --limit 1` shows a successful run that built the Linux binary and image, pushed `ghcr.io/the-vibe-company/openboard:main-<sha>`, and ran `scripts/release/railway-deploy.ts staging main-<sha>`
- [ ] `curl https://<staging host>/healthz` then reports `main-<sha>` of that merge

## Out of scope
- Releases, tags, binaries on GitHub releases and npm (M7, 193, 194).
- The rolling check after each deploy (191).

## Notes
- docs/codebase.md 6.7 (`release.yml`: binaries, image, Railway; not a PR gate) and 7.5 ("every merge to `main` deploys `:main-<sha>` to staging"). Staging runs the bytes CI built, never a Railway-side build.
- `Verify` stays as it is: no binary or image there (docs/codebase.md 6.7).
- The workflow uses the GitHub environment `staging` and its `RAILWAY_TOKEN` (189); pushing to GHCR uses the workflow's `GITHUB_TOKEN` with `packages: write`. A new workflow is the owner's to approve (AGENTS.md "Pull requests"); the PR says so.
- Pin actions by commit, as `.github/workflows/ci.yml` does.

Deferred (owner, 2026-11-24): "pas besoin de déployer sur Railway pour l'instant, je m'en occuperai plus tard". Status `blocked` until the owner deploys; the orchestrator does not launch it.
