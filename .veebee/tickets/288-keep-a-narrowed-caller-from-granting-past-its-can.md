---
id: 288
title: Keep a narrowed caller from granting past its can
milestone: M10-access
package: server
writes:
  - packages/core/src/access/grant-changes.ts
  - packages/core/test/access/grant-changes.test.ts
  - packages/server/src/operations/grants.ts
  - packages/server/test/grants/narrowed.test.ts
conformance: ["grants/takes manage at each pattern a grant names to change it, and at * to list them", "grants/lets no caller narrowed with x-board-can grant past its can, even where everyone's grant closes it"]
modes: [local, hosted]
depends_on: [283, 285, 286]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a board owner, an agent narrowed below its connection's grant cannot use what the header took away to grant more.

## Done when
- [ ] narrowed with `x-board-can: *=all;ops/secret/=`, a `POST /grants` on `ops/` answers 403 `forbidden`, also once an everyone grant closes `ops/secret/`, while one on `ops/ci/` is made
- [ ] narrowed with `x-board-can: *=read,post`, creating, updating, revoking, listing grants and explaining someone else answer 403, and explaining itself answers `grants: []`; narrowed with `manage` only under `work/inner/`, it changes grants there and nowhere else
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `grants/takes manage at each pattern a grant names to change it, and at * to list them` and `grants/lets no caller narrowed with x-board-can grant past its can, even where everyone's grant closes it`, and `--update` records them in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- `everyone` giving more than the caller has (289).

## Notes
- Upstream `docs/01-board/09-access.md` "You can't grant what you don't have: your `x-board-can`'s and your own grants' limits".
- Upstream's `takes manage at each pattern…` check narrows with `x-board-can`, so `.veebee/cut.md` moved its `[c]` here from 283. Depends on 285 as well: 284, 285 and this ticket all change `server/src/operations/grants.ts`.
