---
id: 190
title: Deploy every merge to staging
milestone: M6-high-availability
package: tools
writes:
  - .github/workflows/release.yml
  - .veebee/tickets/190-deploy-every-merge-to-staging.md
  - docs/codebase.md
  - docs/decisions.md
conformance: []
modes: [hosted]
depends_on: [189]
status: done
claimed_by: codex
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

Re-enabled (owner, 2026-11-24: "Ok pour railway pour moi"). Railway is set up: project `openboard` (d2f79d2f-64b8-4c30-b922-3b9502e6ea4e), environment `staging` with a `Postgres` service and an empty `openboard` service at https://openboard-staging.up.railway.app, variables OPENBOARD_DATABASE_URL (reference to Postgres), OPENBOARD_SECRET_KEY, OPENBOARD_PUBLIC_URL, OPENBOARD_SIGNUP=closed already set. GitHub OAuth credentials and any deploy token are set by the owner; never print or commit them.

Decision on #270: publish the commit image on every merge. Deploy only when the repository variable `STAGING_DEPLOY` is `on`, using the `staging` environment secret `RAILWAY_TOKEN`. Record a disabled deploy in the run summary and fail an enabled deploy with `missing RAILWAY_TOKEN` if the secret is absent.
