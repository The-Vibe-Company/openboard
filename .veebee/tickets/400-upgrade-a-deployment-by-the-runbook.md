---
id: 400
title: Upgrade a deployment by the runbook
milestone: M15-operations
package: tools
writes:
  - docs/runbooks/upgrade.md
  - scripts/release/upgrade-drill.ts
  - scripts/release/upgrade-drill.test.ts
  - README.md
conformance: []
modes: [local, hosted]
depends_on: [193]
status: done
claimed_by: Codex
issue: 595
---

## What the user does
As someone running OpenBoard myself, on a laptop, one container or several behind Postgres, I upgrade to a new release by following one page, and I know what to do if it goes wrong.

## Done when
- [ ] `bun scripts/release/upgrade-drill.ts --from <previous release tag>` downloads that release's `openboard-bun-<platform>` with its SHA-256 sum from GitHub releases, checks the sum, runs `serve` on a fresh data directory, posts and claims a task, stops it, starts the binary just built (`bun run build`) on the same directory, and exits 0 once every read answers as before and `backups/pre-migrate-<version>.sqlite` exists; until the first release, verify the flow with `bun test scripts/release/upgrade-drill.test.ts` against fixture binaries
- [ ] `docs/runbooks/upgrade.md` covers local (`ob serve` and the self-host container), self-hosted HA and the hosted service: what to read first, the backup to have, `openboard migrate`, a rolling restart with `/readyz`, how to check it worked, and the way back (no downgrades: restore, 389 or 390); README.md links it
- [ ] the hosted steps are rehearsed locally using two instances on test Postgres, moving from an earlier main image to the current main image; a redacted transcript is in the PR, and the runbook and PR list the owner staging rehearsal once the first release exists

## Out of scope
- Deploying production (193, 215); the rolling check itself (191).
- Downgrades, which are never supported (docs/data-model.md "Migration strategy").

## Notes
- docs/data-model.md "Migration strategy" (SQLite takes a `VACUUM INTO` snapshot before migrating, 212; no downgrades: restore instead), docs/codebase.md 7.5 (expand-only migrations, `openboard migrate` as pre-deploy, rolling deploy) and 7.6 (self-host), docs/architecture.md "Migrations without downtime".
- The drill downloads a release binary from this repository's GitHub releases (194), the only download it makes; it verifies the published SHA-256 before running it.
- Owner first: staging access for the third criterion.

Re-enabled (owner, 2026-11-24: "Ok pour railway pour moi"). Railway is set up: project `openboard` (d2f79d2f-64b8-4c30-b922-3b9502e6ea4e), environment `staging` with a `Postgres` service and an empty `openboard` service at https://openboard-staging.up.railway.app, variables OPENBOARD_DATABASE_URL (reference to Postgres), OPENBOARD_SECRET_KEY, OPENBOARD_PUBLIC_URL, OPENBOARD_SIGNUP=closed already set. GitHub OAuth credentials and any deploy token are set by the owner; never print or commit them.

Orchestrator decision on [#595](https://github.com/The-Vibe-Company/openboard/issues/595): verify the release-binary flow with fixtures until a release exists, rehearse the hosted upgrade locally, and add attachment coverage after 367.
