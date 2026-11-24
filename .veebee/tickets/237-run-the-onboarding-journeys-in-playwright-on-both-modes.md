---
id: 237
title: Run the onboarding journeys in Playwright on both modes
milestone: M8-front
package: web
writes:
  - apps/web/e2e/onboarding.spec.ts
  - apps/web/e2e/scroll.spec.ts
  - apps/web/e2e/support/serve.ts
  - apps/web/e2e/support/board-live.ts
  - apps/web/playwright.config.ts
  - .github/workflows/web.yml
  - .github/workflows/nightly.yml
  - scripts/ci/boundaries.json
  - package.json
  - apps/web/package.json
  - apps/web/tsconfig.json
  - bun.lock
  - docs/codebase.md
  - .oxlintrc.json
conformance: []
modes: [local, hosted]
depends_on: [192, 219, 220, 227, 228, 234]
status: done
claimed_by: codex
issue: 398
---

## What the user does
As the owner, every change to the front or its API is checked in a real browser, on SQLite and on two Postgres instances, along the journeys a new organization takes.

## Done when
- [ ] `bun run e2e apps/web/e2e/onboarding.spec.ts` passes in the `local` project (SQLite): a new person signs up, creates organization `acme` with board `main`, creates a connection, and sees an agent's post (made with that connection's secret through the SDK) arrive live; an invited person signs in and joins; a member reads a channel and posts
- [ ] with the test Postgres up (`docker compose -f docker-compose.test.yml up -d --wait`), `OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun run e2e --project hosted` passes every spec with requests alternating between two instances on one database
- [ ] a pull request touching `apps/web/**`, `packages/sdk/**` or `packages/contract/**` shows `web.yml` green with both projects, and `nightly.yml` runs the full Playwright suite

## Out of scope
- Making `web.yml` a required check: `Verify` stays the only one (docs/codebase.md 6.7); adding a gate is the owner's decision.
- Each page's own spec (216-236), already passing in the `local` project.

## Notes
- docs/project.md M8 "Done when" (the three journeys, green in `web.yml` on both modes), docs/codebase.md 6.1 (browser layer: `apps/web/e2e/**`) and 6.7 (`web.yml`: Vite build, Playwright on Chromium, on those paths; nightly: full Playwright).
- `apps/web/e2e/support/serve.ts` (216) gains the hosted mode: two app instances on one fresh Postgres database behind a round-robin proxy, as `tools/conformance` does (186), so the browser's consecutive requests (a post, then the stream that should see it) land on different instances. Its graph entry in `scripts/ci/boundaries.json` gains `driver-postgres` (owner-reviewed).
- `web.yml` runs Postgres as a service container like `ci.yml`'s `postgres` job; pin actions by commit. A new workflow is the owner's to approve; the PR says so.
- Depends on 192, which writes `.github/workflows/nightly.yml` first.
