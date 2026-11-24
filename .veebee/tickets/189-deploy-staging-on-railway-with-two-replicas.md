---
id: 189
title: Deploy staging on Railway with two replicas
milestone: M6-high-availability
package: tools
writes:
  - scripts/release/railway-deploy.ts
  - scripts/release/railway-deploy.test.ts
  - apps/openboard/src/compose.ts
  - apps/openboard/src/config.ts
  - packages/server/src/deps.ts
  - packages/server/src/http/health.ts
  - docs/protocol.md
  - docs/codebase.md
  - docs/decisions.md
conformance: []
modes: [hosted]
depends_on: [120, 123, 167, 184, 188, 402]
status: done
claimed_by: codex
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
- The owner manages Railway accounts, tokens, billing, and GHCR access. Staging uses one Postgres node on the private network, an `openboard` service with no volume, and the hosted variables from docs/codebase.md 7.5. Ticket 190 publishes the image used for live verification.
- docs/codebase.md 7.5: `railway-deploy.ts` defines the settings and applies them with the image source through `serviceInstanceUpdate`: healthcheck `/readyz` (liveness `/healthz`), timeout, two replicas in `europe-west4-drams3a`, restart on failure, and pre-deploy `openboard migrate` (167). Whether Railway's pre-deploy command fits is unverified (docs/architecture.md "Migrations without downtime"): say in the PR what Railway did.
- `railway-deploy.ts` reads `RAILWAY_TOKEN` from its environment (scripts read their own, docs/codebase.md 3.2) and never prints it; it calls Railway's API with the global `fetch`.
- Also check on staging, and record in the PR: the app-to-database round trip (docs/architecture.md "Hosted on Railway", to measure before launch) and whether the app role can read `pg_control_checkpoint()` (185).

Re-enabled (owner, 2026-11-24: "Ok pour railway pour moi"). Railway is set up: project `openboard` (d2f79d2f-64b8-4c30-b922-3b9502e6ea4e), environment `staging` with a `Postgres` service and an empty `openboard` service at https://openboard-staging.up.railway.app, variables OPENBOARD_DATABASE_URL (reference to Postgres), OPENBOARD_SECRET_KEY, OPENBOARD_PUBLIC_URL, OPENBOARD_SIGNUP=closed already set. GitHub OAuth credentials and any deploy token are set by the owner; never print or commit them.

Orchestrator decision on #269: verify against the fake API in the sandbox. The owner runs the live command after merge once ticket 190 publishes the image.
