---
id: 189
title: Deploy staging on Railway with two replicas
milestone: M6-high-availability
package: tools
writes:
  - railway.hosted.json
  - scripts/release/railway-deploy.ts
  - scripts/release/railway-deploy.test.ts
conformance: []
modes: [hosted]
depends_on: [120, 123, 167, 184, 188]
status: draft
claimed_by: null
issue: 269
---

## What the user does
As the owner, a staging OpenBoard runs on Railway as two replicas on one Railway Postgres, deployed from an image tag with one command.

## Done when
- [ ] with `RAILWAY_TOKEN` in the environment and `ghcr.io/the-vibe-company/openboard:main-<sha>` pushed, `bun scripts/release/railway-deploy.ts staging main-<sha>` points the staging service at that tag, waits until every replica's `/healthz` reports `main-<sha>`, and exits 0; it exits 1 naming the replica that never does
- [ ] `curl https://<staging host>/readyz` answers 200, Railway shows two replicas with `/readyz` as healthcheck and `openboard migrate` as pre-deploy command, and `bun test scripts/release/railway-deploy.test.ts` passes against a faked Railway API

## Out of scope
- Deploying every merge automatically (190); the rolling check (191); nightly runs (192).
- Production (M7, 193, 215).

## Notes
- Staging does not exist yet. Before this ticket can be checked, the owner creates (agents cannot: accounts, tokens and billing are the owner's): the Railway project with a `staging` environment, its Railway Postgres (one node, private network, D38), the `openboard` service with no volume and the GHCR image as source, its variables (`OPENBOARD_DATABASE_URL` as a Railway reference, `OPENBOARD_PUBLIC_URL`, `OPENBOARD_SECRET_KEY`, the GitHub sign-in pair of a staging OAuth app), Railway's access to the GHCR package, and a `RAILWAY_TOKEN` in a GitHub environment `staging`. Until 190 automates it, the first image (188) is pushed by hand by someone holding GHCR write access.
- docs/codebase.md 7.5: `railway.hosted.json` holds the healthcheck `/readyz` (liveness `/healthz`), `numReplicas: 2`, restart on failure, pre-deploy `openboard migrate` (167). Whether Railway's pre-deploy command fits is unverified (docs/architecture.md "Migrations without downtime"): say in the PR what Railway did.
- `railway-deploy.ts` reads `RAILWAY_TOKEN` from its environment (scripts read their own, docs/codebase.md 3.2) and never prints it; it calls Railway's API with the global `fetch`.
- Also check on staging, and record in the PR: the app-to-database round trip (docs/architecture.md "Hosted on Railway", to measure before launch) and whether the app role can read `pg_control_checkpoint()` (185).
