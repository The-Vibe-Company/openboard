---
id: 282
title: Let everyone's grant narrow what others let in
milestone: M10-access
package: core
writes:
  - packages/core/src/access/resolve.ts
  - packages/core/test/access/resolve.test.ts
  - packages/contract/src/entities/discovery.ts
  - packages/server/src/operations/discovery.ts
  - packages/server/test/discovery.test.ts
  - packages/server/test/grants/everyone.test.ts
  - docs/protocol.md
  - docs/decisions.md
conformance: ["grants/lets everyone narrow what something else lets in, and lets no one in itself"]
modes: [local, hosted]
depends_on: [281, 221, 226]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a board owner, I narrow or close a channel for everyone, `ob grants create --everyone --can 'ops/=read'`, while principals named closer keep what their own grants give them there.

## Done when
- [ ] after `ob grants create --everyone --can 'ops/=read'`, a connection whose own grant gives `*=read,post` reads `ops/x` but posting there prints `error: forbidden: …`, until a grant naming it at `ops/` gives `post`; `ob grants explain --github acme/web ops/x` for a repository nothing else lets in shows `pattern: null` and `can: []`
- [ ] with an `--all-projects --environment production` grant at `*` and the everyone grant at `ops/`, `ob grants explain --project prj_x --environment production ops/x` shows `level: "everyone"` and `can: ["read"]`; adding an `--all-projects` grant at `ops/` makes it `level: "group"` with that grant's permissions alone
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `grants/lets everyone narrow what something else lets in, and lets no one in itself`, and `--update` records it in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- Callers narrowed with `x-board-can` against `everyone` (288, 289).

## Notes
- Upstream `docs/01-board/09-access.md` "How grants combine" (`everyone` is "everyone something else lets in").
- **Proposal for the owner: discovery's `team_id`.** Upstream's check stops with "this board names no team" while discovery's `team_id` is null, as docs/protocol.md "Discovery" makes it, so it can only be skipped. Proposed: discovery answers `team_id` with the organization's slug (the organization is upstream's team, docs/data-model.md "Tenancy"), recorded in docs/decisions.md and docs/protocol.md; `all-projects` then groups projects for `explain`, though no project ever signs in. If the owner refuses, this ticket records no check and the check joins 293's `expectedSkips` with that reason. Depends on 221 and 226, the last tickets before it to change docs/protocol.md.
