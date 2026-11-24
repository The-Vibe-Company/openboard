---
id: 279
title: Change a grant by its ID
milestone: M10-access
package: server
writes:
  - packages/contract/src/operations/grants.ts
  - packages/core/src/access/principals.ts
  - packages/core/test/access/principals.test.ts
  - packages/core/src/access/grant-events.ts
  - packages/driver-sql/src/views/grants.ts
  - packages/driver-sql/src/statements.ts
  - packages/server/src/operations/grants.ts
  - packages/server/test/grants/update.test.ts
  - packages/server/test/isolation/cases.ts
  - packages/cli/src/commands/grants.ts
  - packages/cli/test/grants.test.ts
conformance: ["grants/makes another grant for the same principals, and changes one by its ID"]
modes: [local, hosted]
depends_on: [278]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a board owner, I change who a grant names or what it lets in, `ob grants update g5 --add-connection <id> --can 'deploys/=read'`, without remaking it.

## Done when
- [ ] `ob grants update g5 --add-connection <second id> --can 'deploys/=read'` prints `updated g5` with both connections and `deploys/=read`; the first connection's post to `deploys/web` is then `error: forbidden: …`; `--add-project prj_x --environment production` on a grant naming `prj_x` in `preview` joins the environments
- [ ] removing a principal the grant does not name prints `error: not_in_grant: …`, removing its last one `error: grant_empty: …`, and `ob grants update g99 --can 'x=read'` `error: grant_not_found: …`
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `grants/makes another grant for the same principals, and changes one by its ID`, and `--update` records it in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- Who may change which grant (283).

## Notes
Upstream `PATCH /grants/:id { add?, remove?, can?, lockMeOut? }` (remove by who they are; adding a project it names joins the environments); `ob.grant.updated`; `PATCH` is already a contract `Method`.
