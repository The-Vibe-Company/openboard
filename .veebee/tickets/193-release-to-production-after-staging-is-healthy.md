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
conformance: []
modes: [hosted]
depends_on: [191]
status: draft
claimed_by: null
issue: null
---

## What the user does
As the owner, I merge release-please's release PR and that version reaches production only if the same commit already ran healthy on staging.

## Done when
- [ ] `bun test scripts/release/staging-healthy.test.ts` passes against a faked GitHub API: `bun scripts/release/staging-healthy.ts <sha>` exits 0 when a `release.yml` run on `main` for that commit deployed staging and its rolling check passed, and exits 1 with `error: staging_unhealthy: <reason>` when that run is missing, still running, or failed either step
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
