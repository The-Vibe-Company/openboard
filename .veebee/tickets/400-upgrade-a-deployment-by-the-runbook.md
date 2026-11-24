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
status: blocked
claimed_by: null
issue: 595
---

## What the user does
As someone running OpenBoard myself, on a laptop, one container or several behind Postgres, I upgrade to a new release by following one page, and I know what to do if it goes wrong.

## Done when
- [ ] `bun scripts/release/upgrade-drill.ts --from <previous release tag>` downloads that release's `openboard-<target>` with its SHA-256 sum from GitHub releases, checks the sum, runs `serve` on a fresh data directory, posts, claims a task and attaches a file, stops it, starts the binary just built (`bun run build`) on the same directory, and exits 0 once every read answers as before and `backups/pre-migrate-<version>.sqlite` exists; `bun test scripts/release/upgrade-drill.test.ts` passes against fixture binaries
- [ ] `docs/runbooks/upgrade.md` covers local (`ob serve` and the self-host container), self-hosted HA and the hosted service: what to read first, the backup to have, `openboard migrate`, a rolling restart with `/readyz`, how to check it worked, and the way back (no downgrades: restore, 389 or 390); README.md links it
- [ ] the hosted steps are run once on staging by the owner from the page alone, and the transcript is in the PR

## Out of scope
- Deploying production (193, 215); the rolling check itself (191).
- Downgrades, which are never supported (docs/data-model.md "Migration strategy").

## Notes
- docs/data-model.md "Migration strategy" (SQLite takes a `VACUUM INTO` snapshot before migrating, 212; no downgrades: restore instead), docs/codebase.md 7.5 (expand-only migrations, `openboard migrate` as pre-deploy, rolling deploy) and 7.6 (self-host), docs/architecture.md "Migrations without downtime".
- The drill downloads a release binary from this repository's GitHub releases (194), the only download it makes; it verifies the published SHA-256 before running it.
- Owner first: staging access for the third criterion.

Deferred (owner, 2026-11-24): "pas besoin de déployer sur Railway pour l'instant, je m'en occuperai plus tard". Status `blocked` until the owner deploys; the orchestrator does not launch it.
