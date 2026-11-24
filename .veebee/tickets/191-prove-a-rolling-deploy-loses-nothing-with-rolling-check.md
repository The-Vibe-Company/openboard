---
id: 191
title: Prove a rolling deploy loses nothing with rolling-check
milestone: M6-high-availability
package: tools
writes:
  - scripts/release/rolling-check.ts
  - scripts/release/rolling-check.test.ts
  - scripts/release/railway-deploy.ts
  - .github/workflows/release.yml
conformance: []
modes: [hosted]
depends_on: [183, 190]
status: draft
claimed_by: null
issue: 271
---

## What the user does
As the owner, every staging deploy proves that a client following the board through it received every message exactly once, in order.

## Done when
- [ ] `bun scripts/release/rolling-check.ts --url https://<staging host>/api/<staging org>/main < secret-file`, started while `scripts/release/railway-deploy.ts staging <tag>` replaces every replica, keeps a tail open, posts a numbered message every 100 ms until the deploy is done, then exits 0 printing how many it posted and that each arrived once, in order; it exits 1 naming each missing, repeated or out-of-order number
- [ ] the staging deploy of 190 runs it on every merge, and the run of the merge that lands this ticket shows it passing

## Out of scope
- Production releases gated on it (M7, 193).
- Nightly conformance against staging (192).

## Notes
- docs/codebase.md 6.4 (third bullet) and 7.5; docs/project.md M6 "Done when". The tail uses the SDK's `tail()` with reconnect (103, 104), which resumes on another replica by `Last-Event-ID` after a drain (183).
- The board and secret: a dedicated organization on staging (D43 names one for conformance; the same can serve) with a direct connection, created once by the owner through sign-in on staging; its secret lives in the GitHub environment `staging` and reaches the script on stdin, never as an argument (D42).
- `rolling-check.test.ts` covers the counting against an in-process stream, no network.

Re-enabled (owner, 2026-11-24: "Ok pour railway pour moi"). Railway is set up: project `openboard` (d2f79d2f-64b8-4c30-b922-3b9502e6ea4e), environment `staging` with a `Postgres` service and an empty `openboard` service at https://openboard-staging.up.railway.app, variables OPENBOARD_DATABASE_URL (reference to Postgres), OPENBOARD_SECRET_KEY, OPENBOARD_PUBLIC_URL, OPENBOARD_SIGNUP=closed already set. GitHub OAuth credentials and any deploy token are set by the owner; never print or commit them.
