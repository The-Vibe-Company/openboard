---
id: 193
title: Release to production after staging is healthy
milestone: M7-hosted-deploy
package: tools
writes:
  - .github/workflows/release.yml
  - release-please-config.json
  - .release-please-manifest.json
  - scripts/release/staging-healthy.ts
  - scripts/release/staging-healthy.test.ts
  - scripts/release/railway-deploy.ts
  - scripts/release/railway-deploy.test.ts
  - docs/decisions.md
conformance: []
modes: [hosted]
depends_on: [191]
status: done
claimed_by: codex
issue: 354
---

## What the user does
As the owner, I merge release-please's release PR and that version reaches production only if the same commit already ran healthy on staging.

## Done when
- [ ] `bun test scripts/release/staging-healthy.test.ts` passes against a faked GitHub API: `bun scripts/release/staging-healthy.ts <sha>` exits 0 when a `release.yml` run on `main` for that commit deployed staging and its rolling check passed, and exits 1 with `error: staging_unhealthy: <reason>` when the run is missing, the staging job is unfinished or failed, or its rolling check did not pass (including a skipped check)
- [ ] after merging `chore(release): <version>`, `gh run list --workflow release.yml --limit 1` shows a run that tagged `v<version>`, pushed `ghcr.io/the-vibe-company/openboard:<version>` as the image staging ran for that commit, passed `staging-healthy.ts`, then ran `scripts/release/railway-deploy.ts production <version>`; `curl https://<production host>/healthz` then reports `<version>`

## Out of scope
- Binaries and checksums on the GitHub release, multi-arch image (194); npm packages (M12, 348, 349).
- Production's variables, sign-up mode and first organization (215).
- The upgrade runbook (M15, 400).

## Notes
- docs/codebase.md 7.3 (release-please, one version for every manifest and `packages/server/openapi.json` `$.info.version`), 7.4 and 7.5 ("a release deploys `:<version>` to production after the same commit was healthy on staging"). Neither `release-please-config.json` nor its manifest exist yet: this ticket adds them, listing every `package.json` (armada: `release-please-config.json`).
- Production is the image staging tested: tag the `main-<sha>` digest as `<version>` rather than building again, so production runs the bytes CI built (docs/codebase.md 7.5).
- `staging-healthy.ts` reads `GITHUB_TOKEN` from its environment and calls the GitHub API with the global `fetch` (scripts read their own environment, docs/codebase.md 3.2). The rolling check is 191's step in the staging job.
- Owner first: a Railway environment `production` (Railway Postgres, one node; the `openboard` service with two replicas from the GHCR image, no volume; `railway.hosted.json` as on staging) and a GitHub environment `production` holding its own `RAILWAY_TOKEN`, ideally with the owner as required reviewer. Agents cannot create accounts, tokens or environments; the second criterion is checked once they exist. A new workflow step is the owner's to approve (AGENTS.md "Pull requests").
- Pin actions by commit, as `.github/workflows/ci.yml` does.

Re-enabled (owner, 2026-11-24: "Ok pour railway pour moi"). Railway is set up: project `openboard` (d2f79d2f-64b8-4c30-b922-3b9502e6ea4e), environment `staging` with a `Postgres` service and an empty `openboard` service at https://openboard-staging.up.railway.app, variables OPENBOARD_DATABASE_URL (reference to Postgres), OPENBOARD_SECRET_KEY, OPENBOARD_PUBLIC_URL, OPENBOARD_SIGNUP=closed already set. GitHub OAuth credentials and any deploy token are set by the owner; never print or commit them.

Decision on issue #354: the production job depends on staging in the same
workflow. The enclosing run may still be in progress when the staging job has
completed. Deploy only a Release Please release when `PRODUCTION_DEPLOY=on`,
using the GitHub `production` environment. Record skip reasons in the summary.
