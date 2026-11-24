---
id: 215
title: Serve a board on production
milestone: M7-hosted-deploy
package: tools
writes:
  - scripts/release/smoke.ts
  - scripts/release/smoke.test.ts
  - docs/architecture.md
conformance: []
modes: [hosted]
depends_on: [193, 195, 196, 199, 208]
status: draft
claimed_by: null
issue: null
---

## What the user does
As the owner, production runs on Railway with invite-only sign-up, and our own organization `tvc` uses a board there.

## Done when
- [ ] `curl -s https://<production host>/healthz` reports the version of the last release, `curl -s -o /dev/null -w '%{http_code}' https://<production host>/readyz` prints `200` while Railway shows two replicas, and signing in at `https://<production host>/auth/github/start` with a GitHub account that holds no invitation answers 403 `forbidden`
- [ ] `bun scripts/release/smoke.ts --url https://<production host>/api/tvc/main < secret-file` posts a numbered message to `openboard/ops` as a connection of organization `tvc`, reads it back, and exits 0; it exits 1 with `error: smoke_failed: <step>` when a step fails
- [ ] `bun test scripts/release/smoke.test.ts` passes against an in-process app, no network

## Out of scope
- Releasing and deploying (193, 194); the bucket's variables and backups (210, 211).
- Dogfooding conventions in `tvc` (one thread per PR, ops reports): process, not code (docs/project.md 6, phase A).

## Notes
- docs/project.md M7 "Done when" (production serves sign-up and a board) and 6 (phase A: organization `tvc` on production, channels `openboard/dev`, `openboard/ops`, `openboard/decisions`; never staging). docs/codebase.md 7.5 (production's variables).
- Owner first, as for staging (189): production's variables (`OPENBOARD_PUBLIC_URL` on the production domain, `OPENBOARD_SECRET_KEY`, `OPENBOARD_SIGNUP=invite` per Q6, the GitHub sign-in pair of a production OAuth app, `OPENBOARD_DATABASE_URL` as a Railway reference), the domain, and the organization `tvc`. Bootstrapping an invite-only instance has no invitation to start from: the owner signs up once while `OPENBOARD_SIGNUP=open`, creates `tvc`, then sets `invite` and redeploys; say in the PR how it went. The smoke connection's secret lives in the GitHub environment `production` and reaches the script on stdin (D42).
- Measure on production and record in docs/architecture.md "Hosted on Railway": the app-to-database round trip and the restart time of the database service (listed there as "to measure before launch").
- The script reuses the SDK (`@the-vibe-company/openboard`) with the secret, as an agent would; 193's workflow may call it after each production deploy once this lands.
