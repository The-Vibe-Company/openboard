---
id: 280
title: Keep a grant's can as written
milestone: M10-access
package: core
writes:
  - packages/core/src/access/grants.ts
  - packages/core/test/access/grants.test.ts
  - packages/core/src/access/resolve.ts
  - packages/core/test/access/resolve.test.ts
  - packages/contract/src/entities/grants.ts
  - packages/server/test/grants/can-as-written.test.ts
conformance: ["grants/keeps a grant's can as written, a pattern with no permissions included"]
modes: [local, hosted]
depends_on: [279]
status: draft
claimed_by: null
issue: 455
---

## What the user does
As a board owner, I close part of a pattern with `none`, `ob grants create --connection <id> --can 'ops/=read' --can 'ops/secret/=none'`, and the grant keeps exactly what I wrote.

## Done when
- [ ] that command makes a grant whose `can` reads back from `ob grants --json` as written, `{ "ops/": ["read"], "ops/secret/": [] }` (and `*=all` as `"all"`); the connection then reads `ops/web` but neither reads nor posts in `ops/secret/x`
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `grants/keeps a grant's can as written, a pattern with no permissions included`, and `--update` records it in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- `everyone` closing a pattern (282).

## Notes
Upstream "Its `can` maps each channel pattern to `"all"` or a list, `[]` for none, and is kept as written". `compileCan` (`core/src/access/grants.ts`) expands `all` and refuses `[]` with `grant_empty`: keep the written `can` in the grant and compile it when checking, a `[]` pattern letting nothing in there (the most specific pattern decides).
