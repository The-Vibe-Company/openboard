---
id: 284
title: Refuse a grant that would lock its maker out
milestone: M10-access
package: server
writes:
  - packages/core/src/access/lockout.ts
  - packages/core/test/access/lockout.test.ts
  - packages/server/src/operations/grants.ts
  - packages/server/test/grants/lockout.test.ts
  - packages/cli/src/commands/grants.ts
  - packages/cli/test/grants.test.ts
conformance: ["grants/refuses a grant its maker couldn't take back, unless it says lockMeOut"]
modes: [local, hosted]
depends_on: [283]
status: draft
claimed_by: null
issue: 459
---

## What the user does
As a connection that manages grants, I am stopped before a grant I could not take back, and told which grant to make first.

## Done when
- [ ] as a direct connection whose grant is `*=all`, `ob grants create --everyone --can 'factory/=read'` prints `error: grant_lockout: …`, the grant to make first (`ob grants create --connection <its id> --can factory/=all`) and the `--lock-me-out` way, and `ob grants` lists the same grants as before; after that first grant, the same command succeeds, and `--lock-me-out` makes it without one
- [ ] revoking or narrowing the grant that keeps the caller in is refused the same way, and the local owner, or an organization owner or admin, is never locked out
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `grants/refuses a grant its maker couldn't take back, unless it says lockMeOut`, and `--update` records it in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- A lock and its keeping grant in one write (285).

## Notes
Upstream `vb grants` "A change you couldn't take back is refused, with reason `grant_lockout` … An owner is never locked out" and `GrantWriteOptions.lockMeOut`; the hint names the caller as a grant would (`--connection`, `--user`).
