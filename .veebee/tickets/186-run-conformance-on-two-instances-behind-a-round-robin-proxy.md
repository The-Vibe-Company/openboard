---
id: 186
title: Run conformance on two instances behind a round-robin proxy
milestone: M6-high-availability
package: tools
writes:
  - tools/conformance/src/drivers.ts
  - .github/workflows/ci.yml
  - scripts/ci/verify-pg.ts
conformance: []
modes: [local, hosted]
depends_on: [177, 181]
status: done
claimed_by: Codex
issue: 266
---

## What the user does
As a contributor, upstream's kit passes the same checks on two hosted instances sharing one Postgres, with consecutive requests landing on different instances.

## Done when
- [x] `OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun run conformance --driver postgres --instances 2` boots two instances on one fresh database behind the local round-robin proxy and exits 0 with no lost check: `hosted` stays equal to `local`
- [x] the `conformance-postgres` CI job and `bun run verify:pg` run it with `--instances 2` again

## Out of scope
- Running the kit against a deployed instance with `--url` (192).
- New checks: the score is unchanged by this ticket.

## Notes
- docs/codebase.md 6.3 step 1 and 6.4. The proxy and the two-server boot already exist in `tools/conformance/src/drivers.ts` (they alternate requests between SQLite apps that share nothing); after 170 both instances run `postgresDriver` on one database, each with its own pool and listener, as two processes would.
- Undoes 170's `--instances 1` in `.github/workflows/ci.yml` and `scripts/ci/verify-pg.ts`; the PR names that change.
- Depends on 181 because both change `tools/conformance/src/drivers.ts`.
